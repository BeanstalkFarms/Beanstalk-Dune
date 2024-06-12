const fs = require('fs');
const readline = require('readline');
const { BEANSTALK } = require('../addresses.js');
const storageLayout = require('../contracts/beanstalk/storageLayout.json');
const ContractStorage = require('../datasources/storage/src/contract-storage');
const { providerThenable } = require('../provider');
const { bigintHex } = require('../utils/json-formatter.js');
const { absBigInt } = require('../utils/bigint.js');
const { asyncBeanstalkContractGetter } = require('../datasources/contract-function.js');

function parseLine(deposits, line) {
  const elem = line.split(',');
  if (elem[0] == 'account') {
    // Skip first line of csv
    return;
  }

  let [account, _, token, stem, amount, bdv] = elem;

  stem = transformStem(BigInt(stem));

  if (!deposits[account]) {
    deposits[account] = {}
  }

  if (!deposits[account][token]) {
    deposits[account][token] = {};
  }
  deposits[account][token][stem] = {
    amount: BigInt(amount),
    bdv: BigInt(bdv)
  };
}

// Transforms the stem according to silo v3.1 if necessary
function transformStem(stem) {
  if (absBigInt(stem) < BigInt(10 ** 6)) {
    return stem * BigInt(10 ** 6);
  }
  return stem;
}

// Gets the mow stem and scales if appropriate
async function getMowStem(account, token, lastUpdate, stemScaleSeason) {
  const bs = new ContractStorage(await providerThenable, BEANSTALK, storageLayout);
  const stem = await bs.s.a[account].mowStatuses[token].lastStem;
  if (lastUpdate < stemScaleSeason && lastUpdate > 0) {
    return transformStem(stem);
  }
  return stem;
}

async function checkWallets(deposits) {
  const results = {};
  const depositors = Object.keys(deposits);

  const bs = new ContractStorage(await providerThenable, BEANSTALK, storageLayout);
  const stemScaleSeason = await bs.s.season.stemScaleSeason;

  for (let i = 0; i < depositors.length; ++i) {

    const depositor = depositors[i];
    results[depositor] = { breakdown: {} };
    const lastUpdate = bs.s.a[depositor].lastUpdate;

    let netDepositorStalk = 0n;
    for (const token in deposits[depositor]) {

      const mowStem = await getMowStem(depositor, token, lastUpdate, stemScaleSeason);
      let netTokenStalk = 0n;
      for (const stem in deposits[depositor][token]) {
        const stemDelta = mowStem - BigInt(stem);
        // Deposit stalk = grown + base stalk
        // stems have 6 precision, though 10 is needed to grow one stalk. 10 + 6 - 6 => 10 precision for stalk
        netTokenStalk += (stemDelta + transformStem(10000n)) * deposits[depositor][token][stem].bdv / BigInt(10 ** 6);
      }
      netDepositorStalk += netTokenStalk;
      results[depositor].breakdown[token] = netTokenStalk;
    }

    results[depositor].depositStalk = netDepositorStalk;
    results[depositor].contractStalk = await getContractStalk(depositor);
    results[depositor].discrepancy = results[depositor].depositStalk - results[depositor].contractStalk;

    console.log(`${i + 1} / ${depositors.length}`);
  }

  // Format the result with raw hex values and decimal values
  const reducer = (result, [k, v]) => {
    if (typeof v === 'bigint') {
      result[k] = (Number(v / BigInt(10 ** 8)) / Math.pow(10, 2)).toLocaleString();
    } else {
      result[k] = Object.entries(v).reduce(reducer, {});
    }
    return result;
  };

  return Object.entries(results).reduce((result, [k, v]) => {
    result[k] =  {
      raw: v,
      formatted: Object.entries(v).reduce(reducer, {})
    };
    return result;
  }, {});
}

// Since we need to match the stalk + grown stalk by bdv against the contract values, need to include
// anything that has finished germinating or is still germinating (and this not part of s.a[depositor].s.stalk)
// NOT including earned beans since we are only trying to verify deposits.
async function getContractStalk(account) {
  const bs = new ContractStorage(await providerThenable, BEANSTALK, storageLayout);
  const beanstalk = await asyncBeanstalkContractGetter();

  const [storage, germinating, doneGerminating] = await Promise.all([
    bs.s.a[account].s.stalk,
    (async () => {
      return BigInt(await beanstalk.callStatic.balanceOfGerminatingStalk(account));
    })(),
    (async () => {
      return BigInt((await beanstalk.callStatic.balanceOfFinishedGerminatingStalkAndRoots(account))[0]);
    })()
  ]);
  return storage + germinating + doneGerminating;
}


(async () => {

  // https://dune.com/queries/3819175
  const fileStream = fs.createReadStream(`${__dirname}/data/deposit-stems.csv`);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const deposits = {};
  console.log('Reading deposits data from file');
  rl.on('line', (line) => {
    parseLine(deposits, line);
  });

  rl.on('close', async () => {
    console.log(`Checking ${Object.keys(deposits).length} wallets`);
    const results = await checkWallets(deposits);
    await fs.promises.writeFile('results/stalk-audit.json', JSON.stringify(results, bigintHex, 2));

    const formatted = Object.entries(results).filter(([k, v]) =>
      results[k].raw.discrepancy !== '0x0'
    ).sort(([_, a], [_1, b]) =>
      Math.abs(parseFloat(b.formatted.discrepancy.replace(/,/g, ''))) - Math.abs(parseFloat(a.formatted.discrepancy.replace(/,/g, '')))
    );
    await fs.promises.writeFile('results/stalk-audit-formatted.json', JSON.stringify(formatted, bigintHex, 2));

    // const specificWallet = '0xef49ffe2c1a6f64cfe18a26b3efe7d87830838c8'
    // const results = await checkWallets({[specificWallet]: deposits[specificWallet]});
    // console.log(JSON.stringify(results, bigintHex, 2));
  });
})();

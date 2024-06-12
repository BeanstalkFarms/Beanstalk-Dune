const fs = require('fs');
const readline = require('readline');
const { BEANSTALK } = require('../addresses.js');
const storageLayout = require('../contracts/beanstalk/storageLayout.json');
const ContractStorage = require('../datasources/storage/src/contract-storage');
const { providerThenable } = require('../provider');
const { bigintHex } = require('../utils/json-formatter.js');
const { absBigInt } = require('../utils/bigint.js');

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

async function checkWallets(deposits) {
  const results = {};
  const bs = new ContractStorage(await providerThenable, BEANSTALK, storageLayout);
  const depositors = Object.keys(deposits);
  for (let i = 0; i < depositors.length; ++i) {

    const depositor = depositors[i];
    results[depositor] = { breakdown: {} };

    let netDepositorStalk = 0n;
    for (const token in deposits[depositor]) {

      const mowStem = transformStem(await bs.s.a[depositor].mowStatuses[token].lastStem);
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
    results[depositor].contractStalk = await bs.s.a[depositor].s.stalk;
    results[depositor].discrepancy = results[depositor].depositStalk - results[depositor].contractStalk;

    // console.log(`net deposit stalk for ${depositor}: ${netDepositorStalk}`);
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
    // const specificWallet = '0x0127F5b0e559D1C8C054d83f8F187CDFDc80B608'
    // const results = await checkWallets({[specificWallet]: deposits[specificWallet]});
    await fs.promises.writeFile('results/stalk-audit.json', JSON.stringify(results, bigintHex, 2));
  });

})();

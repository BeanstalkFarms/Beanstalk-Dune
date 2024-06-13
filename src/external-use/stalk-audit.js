const fs = require('fs');
const readline = require('readline');
const { BEANSTALK, BEANWETH } = require('../addresses.js');
const storageLayout = require('../contracts/beanstalk/storageLayout.json');
const ContractStorage = require('../datasources/storage/src/contract-storage');
const { providerThenable } = require('../provider');
const { bigintHex } = require('../utils/json-formatter.js');
const { asyncBeanstalkContractGetter } = require('../datasources/contract-function.js');
const retryable = require('../utils/retryable.js');

let bs;
let stemScaleSeason;
let accountUpdates = {};
let parseProgress = 0;

const EXPORT_BLOCK = 20080444;

// Equivalent to LibBytes.packAddressAndStem
function packAddressAndStem(address, stem) {
  const addressBigInt = BigInt(address);
  const stemBigInt = BigInt(stem);
  return (addressBigInt << BigInt(96)) | (stemBigInt & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFF'));
}

async function parseLine(deposits, line) {
  const elem = line.split(',');
  if (elem[0] == 'account') {
    // Skip first line of csv
    return;
  }

  let [account, _, token, stem, amount, bdv] = elem;

  // Get info that is required to process the appropriate stems
  if (!stemScaleSeason) {
    stemScaleSeason = await bs.s.season.stemScaleSeason;
  }

  if (!accountUpdates[account]) {
    accountUpdates[account] = await bs.s.a[account].lastUpdate;
  }

  // Transform stem if needed
  const { actualStem, isMigrated3_1 } = await transformStem(account, token, BigInt(stem));

  if (!deposits[account]) {
    deposits[account] = {}
  }

  if (!deposits[account][token]) {
    deposits[account][token] = {};
  }
  deposits[account][token][actualStem] = {
    amount: BigInt(amount),
    bdv: BigInt(bdv),
    isMigrated3_1
  };

  process.stdout.write(`\r${++parseProgress} / ?`);
}

// Transforms the stem according to silo v3.1
function scaleStem(stem) {
  return stem * BigInt(10 ** 6);
}

// Transforms the stem according to silo v3.1 if appropriate. Checks for legacy deposit
async function transformStem(account, token, stem) {
  const depositId = packAddressAndStem(token, stem);
  // console.log(token, stem, await bs.s.a[account].legacyV3Deposits[depositId].amount);
  if (await bs.s.a[account].legacyV3Deposits[depositId].amount > 0n) {
    return {
      actualStem: scaleStem(stem),
      isMigrated3_1: false
    }
  }
  return {
    actualStem: stem,
    isMigrated3_1: true
  }
}

async function checkWallets(deposits) {
  const results = {};
  const depositors = Object.keys(deposits);

  for (let i = 0; i < depositors.length; ++i) {

    const depositor = depositors[i];
    results[depositor] = { breakdown: {} };

    let netDepositorStalk = 0n;
    for (const token in deposits[depositor]) {

      let mowStem = await bs.s.a[depositor].mowStatuses[token].lastStem;
      // console.log(mowStem, Object.keys(deposits[depositor][token]));
      if (mowStem < Math.max(...Object.keys(deposits[depositor][token]))) {
        // console.log(`mowStem needed adjustment for account: ${depositor}, token: ${token}`);
        mowStem = scaleStem(mowStem);
      }

      let netTokenStalk = 0n;
      for (const stem in deposits[depositor][token]) {
        const stemDelta = mowStem - BigInt(stem);
        // Deposit stalk = grown + base stalk
        // stems have 6 precision, though 10 is needed to grow one stalk. 10 + 6 - 6 => 10 precision for stalk
        netTokenStalk += (stemDelta + 10000000000n) * deposits[depositor][token][stem].bdv / BigInt(10 ** 6);
        // console.log(`token: ${token}, stem: ${stem}${!deposits[depositor][token][stem].isMigrated3_1 ? '(scaled)' : ''}, mowStem: ${mowStem}, bdv: ${deposits[depositor][token][stem].bdv}`);
      }
      netDepositorStalk += netTokenStalk;
      results[depositor].breakdown[token] = netTokenStalk;
    }

    results[depositor].depositStalk = netDepositorStalk;
    results[depositor].contractStalk = await getContractStalk(depositor);
    results[depositor].discrepancy = results[depositor].depositStalk - results[depositor].contractStalk;

    process.stdout.write(`\r${i + 1} / ${depositors.length}`);
  }
  process.stdout.write('\n');

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
  const beanstalk = await asyncBeanstalkContractGetter();

  const [storage, germinating, doneGerminating] = await Promise.all([
    bs.s.a[account].s.stalk,
    retryable(async () => {
      return BigInt(await beanstalk.callStatic.balanceOfGerminatingStalk(account, { blockTag: EXPORT_BLOCK }));
    }),
    retryable(async () => {
      return BigInt((await beanstalk.callStatic.balanceOfFinishedGerminatingStalkAndRoots(account, { blockTag: EXPORT_BLOCK }))[0]);
    })
  ]);
  return storage + germinating + doneGerminating;
}

(async () => {

  bs = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, EXPORT_BLOCK);

  const specificWallet = '0x5ab404ab63831bfcf824f53b4ac3737b9d155d90';

  // const depositId = packAddressAndStem('0x1bea0050e63e05fbb5d8ba2f10cf5800b6224449', -18632000000);
  // console.log('silo v3', await bs.s.a[specificWallet].legacyV3Deposits[depositId].amount);
  // console.log('silo v3.1', await bs.s.a[specificWallet].deposits[depositId].amount);

  // https://dune.com/queries/3819175
  const fileStream = fs.createReadStream(`${__dirname}/data/deposit-stems.csv`);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const deposits = {};
  console.log('Reading deposits data from file');
  for await (const line of rl) {
    // if (line.includes(specificWallet)) {
      await parseLine(deposits, line);
    // }
  }
  process.stdout.write('\n');
  console.log(`Finished processing ${parseProgress} entries`);

  ///
  console.log(`Checking ${Object.keys(deposits).length} wallets`);
  const results = await checkWallets(deposits);
  await fs.promises.writeFile('results/stalk-audit.json', JSON.stringify(results, bigintHex, 2));

  const formatted = Object.entries(results).filter(([k, v]) =>
    results[k].raw.discrepancy !== '0x0'
  ).sort(([_, a], [_1, b]) =>
    Math.abs(parseFloat(b.formatted.discrepancy.replace(/,/g, ''))) - Math.abs(parseFloat(a.formatted.discrepancy.replace(/,/g, '')))
  );
  await fs.promises.writeFile('results/stalk-audit-formatted.json', JSON.stringify(formatted, bigintHex, 2));
  ///
  // const results = await checkWallets({[specificWallet]: deposits[specificWallet]});
  // console.log(JSON.stringify(results, bigintHex, 2));
})();

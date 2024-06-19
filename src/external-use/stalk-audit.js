const fs = require('fs');
const readline = require('readline');
const { BEANSTALK, BEANWETH } = require('../addresses.js');
const storageLayout = require('../contracts/beanstalk/storageLayout.json');
const ContractStorage = require('../datasources/storage/src/contract-storage');
const { providerThenable } = require('../provider');
const { bigintHex } = require('../utils/json-formatter.js');
const { asyncBeanstalkContractGetter } = require('../datasources/contract-function.js');
const retryable = require('../utils/retryable.js');

let beanstalk;
let bs;

let stemScaleSeason;
let accountUpdates = {};
let parseProgress = 0;
let stemTips = {};

const EXPORT_BLOCK = 20000000; // main file is 20087633

const specificWallet = '0xab557f77ef6d758a18df60acfacb1d5fee4c09c2';
const dataFile = '20000000';

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

  if (!stemTips[token]) {
    stemTips[token] = await retryable(async () => {
      return BigInt(await beanstalk.callStatic.stemTipForToken(token, { blockTag: EXPORT_BLOCK }))
    });
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
      if (
        // If stemScaleSeason is unset, then that upgrade hasnt happened yet and thus the user hasnt migrated
        stemScaleSeason == 0
        || (accountUpdates[depositor] < stemScaleSeason && accountUpdates[depositor] > 0)
        // Edge case for when user update and stem scale occurred at the same season
        || (accountUpdates[depositor] == stemScaleSeason && mowStem > 0 && stemTips[token] / mowStem >= BigInt(10 ** 6))
      ) {
        mowStem = scaleStem(mowStem);
      }
      // console.log(accountUpdates[depositor], stemScaleSeason);
      // console.log('total token bdv (mowStatuses)', await bs.s.a[depositor].mowStatuses[token].bdv, await bs.s.a[depositor].mowStatuses[token].lastStem);

      let netTokenStalk = 0n;
      let undivided = 0n;
      for (const stem in deposits[depositor][token]) {
        const stemDelta = mowStem - BigInt(stem);
        // Deposit stalk = grown + base stalk
        // stems have 6 precision, though 10 is needed to grow one stalk. 10 + 6 - 6 => 10 precision for stalk
        netTokenStalk += (stemDelta + 10000000000n) * deposits[depositor][token][stem].bdv / BigInt(10 ** 6);
        undivided += (stemDelta + 10000000000n) * deposits[depositor][token][stem].bdv;
        // console.log(`token: ${token}, stem: ${stem}${!deposits[depositor][token][stem].isMigrated3_1 ? '(scaled)' : ''}, mowStem: ${mowStem}, bdv: ${deposits[depositor][token][stem].bdv}`);
      }
      netDepositorStalk += netTokenStalk;
      results[depositor].breakdown[token] = netTokenStalk;
      // console.log('undivided result', netTokenStalk, undivided / BigInt(10 ** 6));
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
  const [storage, germinating, doneGerminating] = await Promise.all([
    bs.s.a[account].s.stalk,
    retryable(async () => {
      try {
        return BigInt(await beanstalk.callStatic.balanceOfGerminatingStalk(account, { blockTag: EXPORT_BLOCK }));
      } catch (e) {
        // Germination may not be implemented yet
        return 0n;
      }
    }),
    retryable(async () => {
      try {
        return BigInt((await beanstalk.callStatic.balanceOfFinishedGerminatingStalkAndRoots(account, { blockTag: EXPORT_BLOCK }))[0]);
      } catch (e) {
        // Germination may not be implemented yet
        return 0n;
      }
    })
  ]);
  return storage + germinating + doneGerminating;
}

(async () => {

  beanstalk = await asyncBeanstalkContractGetter();
  bs = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, EXPORT_BLOCK);

  // const depositId = packAddressAndStem('0x1bea0050e63e05fbb5d8ba2f10cf5800b6224449', -18632000000);
  // console.log('silo v3', await bs.s.a[specificWallet].legacyV3Deposits[depositId].amount);
  // console.log('silo v3.1', await bs.s.a[specificWallet].deposits[depositId].amount);

  // https://dune.com/queries/3819175
  const fileStream = fs.createReadStream(`${__dirname}/data/stems/deposit-stems${dataFile}.csv`);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const deposits = {};
  console.log('Reading deposits data from file');
  for await (const line of rl) {
    if (!specificWallet || line.includes(specificWallet)) {
      await parseLine(deposits, line);
    }
  }
  process.stdout.write('\n');
  console.log(`Finished processing ${parseProgress} entries`);

  if (!specificWallet) {
    // Check all wallets and output to file
    console.log(`Checking ${Object.keys(deposits).length} wallets`);
    const results = await checkWallets(deposits);
    await fs.promises.writeFile(`results/stalk-audit/stalk-audit${dataFile}.json`, JSON.stringify(results, bigintHex, 2));

    const formatted = Object.entries(results).filter(([k, v]) =>
      results[k].raw.discrepancy !== 0n
    ).sort(([_, a], [_1, b]) =>
      Math.abs(parseFloat(b.formatted.discrepancy.replace(/,/g, ''))) - Math.abs(parseFloat(a.formatted.discrepancy.replace(/,/g, '')))
    );
    await fs.promises.writeFile(`results/stalk-audit/stalk-audit-formatted${dataFile}.json`, JSON.stringify(formatted, bigintHex, 2));
  } else {
    // Check the specified wallet only and do not write output to the file
    const results = await checkWallets({[specificWallet]: deposits[specificWallet]});
    console.log(JSON.stringify(results, bigintHex, 2));
  }
  
})();

function findDiscrepancyChanges() {

  const audit18 = require('../../results/stalk-audit/stalk-audit18000000.json');
  const auditNow = require('../../results/stalk-audit/stalk-audit.json');

  for (const account in audit18) {
    if (!auditNow[account]) {
      console.log('account no longer in output today', account);
    } else if (audit18[account].raw.discrepancy !== auditNow[account].raw.discrepancy
        // Ignore ebip17 fixes
        && auditNow[account].formatted.discrepancy === '0'
    ) {
      // Log increasing discrepancies
      const diff = parseInt(auditNow[account].raw.discrepancy, 16) - parseInt(audit18[account].raw.discrepancy, 16);
      if (diff > 0) {
        console.log('account discrepancy didn\'t match', account, diff);
      }
    }
  }
}
// findDiscrepancyChanges();
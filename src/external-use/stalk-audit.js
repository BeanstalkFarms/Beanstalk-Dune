const fs = require('fs');
const readline = require('readline');
const { BEANSTALK, BEAN, UNRIPE_BEAN, UNRIPE_LP, BEAN3CRV, BEANWETH } = require('../addresses.js');
const storageLayout = require('../contracts/beanstalk/storageLayout.json');
const ContractStorage = require('../datasources/storage/src/contract-storage');
const { providerThenable } = require('../provider');
const { bigintHex, bigintDecimal } = require('../utils/json-formatter.js');
const { asyncBeanstalkContractGetter } = require('../datasources/contract-function.js');
const retryable = require('../utils/retryable.js');
const { tokenEq } = require('../utils/token.js');

let beanstalk;
let bs;

// Exploit migration
const INITIAL_RECAP = BigInt(185564685220298701);
const AMOUNT_TO_BDV_BEAN_ETH = BigInt(119894802186829);
const AMOUNT_TO_BDV_BEAN_3CRV = BigInt(992035);
const AMOUNT_TO_BDV_BEAN_LUSD = BigInt(983108);
const UNRIPE_CURVE_BEAN_METAPOOL = '0x3a70DfA7d2262988064A2D051dd47521E43c9BdD';
const UNRIPE_CURVE_BEAN_LUSD_POOL = '0xD652c40fBb3f06d6B58Cb9aa9CFF063eE63d465D';

let stemStartSeason; // For v2 -> v3
let stemScaleSeason; // For v3 -> v3.1
let accountUpdates = {};
let parseProgress = 0;
let walletProgress = 0;
let stemTips = {};

const REPLANT_BLOCK = 15278963;
const SILO_V3_BLOCK = 17671557;
const EXPORT_BLOCK = 18218395; // unlabeled file was 20087633

const BATCH_SIZE = 100;
const WALLET_LIMIT = undefined;
const specificWallet = '0x3cc6cc687870c972127e073e05b956a1ee270164'.toLowerCase();
const dataFile = '18218395';

// Equivalent to LibBytes.packAddressAndStem
function packAddressAndStem(address, stem) {
  const addressBigInt = BigInt(address);
  const stemBigInt = BigInt(stem);
  return (addressBigInt << BigInt(96)) | (stemBigInt & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFF'));
}

// Equivalent to LibLegacyTokenSilo.seasonToStem
function seasonToStem(season, seedsPerBdv) {
  return (BigInt(season) - stemStartSeason) * (seedsPerBdv * BigInt(10 ** 6));
}

// Equivalent to LibLegacyTokenSilo.getLegacySeedsPerToken
function getLegacySeedsPerToken(token) {
  if (tokenEq(token, BEAN)) {
    return 2n;
  } else if (tokenEq(token, UNRIPE_BEAN)) {
    return 2n;
  } else if (tokenEq(token, UNRIPE_LP)) {
    return 4n;
  } else if (tokenEq(token, BEAN3CRV)) {
    return 4n;
  }
  return 0n;
}

async function getBeanEthUnripeLP(account, season) {
  return {
    amount: (await bs.s.a[account].lp.deposits[season]) * AMOUNT_TO_BDV_BEAN_ETH / BigInt(10 ** 18),
    bdv: (await bs.s.a[account].lp.depositSeeds[season]) / BigInt(4)
  }
}

async function getBean3CrvUnripeLP(account, season) {
  return {
    amount: (await bs.s.a[account].legacyV2Deposits[UNRIPE_CURVE_BEAN_METAPOOL][season].amount) * AMOUNT_TO_BDV_BEAN_3CRV / BigInt(10 ** 18),
    bdv: await bs.s.a[account].legacyV2Deposits[UNRIPE_CURVE_BEAN_METAPOOL][season].bdv
  }
}

async function getBeanLusdUnripeLP(account, season) {
  return {
    amount: (await bs.s.a[account].legacyV2Deposits[UNRIPE_CURVE_BEAN_LUSD_POOL][season].amount) * AMOUNT_TO_BDV_BEAN_LUSD / BigInt(10 ** 18),
    bdv: await bs.s.a[account].legacyV2Deposits[UNRIPE_CURVE_BEAN_LUSD_POOL][season].bdv
  }
}

async function preProcessInit(deposits, lines) {
  for (const line of lines) {
    const [account, token] = line.split(',');

    if (Object.keys(deposits).length >= WALLET_LIMIT && !Object.keys(deposits).includes(account)) {
      continue;
    }

    if (!deposits[account]) {
      deposits[account] = {};
    }
    if (!deposits[account][token]) {
      deposits[account][token] = {};
    }
  }
}

// Silo v3 migrated stems
async function processLine(deposits, line) {
  let [account, token, stem, season, amount, bdv] = line.split(',');

  // For testing on a subset of wallets
  if (Object.keys(deposits).length >= WALLET_LIMIT && !Object.keys(deposits).includes(account)) {
    return;
  }

  let version = '';

  if (stem !== '') {
    // This is needed for the v3.1 edgecase
    if (!stemTips[token]) {
      stemTips[token] = await retryable(async () => {
        return BigInt(await beanstalk.callStatic.stemTipForToken(token, { blockTag: EXPORT_BLOCK }))
      });
    }

    // Silo v3 migrated stems. Transform to v3.1 if needed
    const { actualStem, isMigrated3_1 } = await transformStem(account, token, BigInt(stem));
    stem = actualStem;
    version = isMigrated3_1 ? 'v3.1' : 'v3';

  } else {
    // Deposits by season. The RemoveDeposit(s) events are missing bdv from
    // the event data, so the information must be retrieved from storage directly. The provided entires are
    // all tokens/season numbers for each user. Pre-replant events are not included.
    // In theory there shouldnt be any users here who also have a v3 deposit.
    stem = seasonToStem(season, getLegacySeedsPerToken(token));
    amount = await bs.s.a[account].legacyV2Deposits[token][season].amount;
    bdv = await bs.s.a[account].legacyV2Deposits[token][season].bdv;
    if (season < 6075) {
      if (tokenEq(token, UNRIPE_BEAN)) {
        // LibUnripeSilo.unripeBeanDeposit
        const legacyAmount = await bs.s.a[account].bean.deposits[season];
        amount = amount + legacyAmount;
        bdv = bdv + legacyAmount * INITIAL_RECAP / BigInt(10 ** 18)
      } else if (tokenEq(token, UNRIPE_LP)) {
        // LibUnripeSilo.unripeLPDeposit
        const { amount: ethAmount, bdv: ethBdv } = await getBeanEthUnripeLP(account, season);
        const { amount: crvAmount, bdv: crvBdv } = await getBean3CrvUnripeLP(account, season);
        const { amount: lusdAmount, bdv: lusdBdv } = await getBeanLusdUnripeLP(account, season);
        
        amount = amount + ethAmount + crvAmount + lusdAmount;
        const legBdv = (ethBdv + crvBdv + lusdBdv) * INITIAL_RECAP / BigInt(10 ** 18);
        bdv = bdv + legBdv;
      }
    }
    // console.log(account, token, season, amount, bdv);
    version = 'season';
  }

  deposits[account][token][stem] = {
    amount: BigInt(amount),
    bdv: BigInt(bdv),
    version
  };

  process.stdout.write(`\r${++parseProgress} / ?`);
}

// Now that all deposits are populated, calculate total deposited amount/bdv for each token per user
function calcDepositTotals(deposits) {
  for (const account in deposits) {
    deposits[account].totals = {};
    for (const token in deposits[account]) {
      if (token == 'totals') {
        continue;
      }
      deposits[account].totals[token] = {
        amount: 0n,
        bdv: 0n,
        seeds: 0n
      };
      for (const stem in deposits[account][token]) {
        deposits[account].totals[token].amount += deposits[account][token][stem].amount;
        deposits[account].totals[token].bdv += deposits[account][token][stem].bdv;
        if (deposits[account][token][stem].version === 'season') {
          deposits[account].totals[token].seeds += deposits[account][token][stem].bdv * getLegacySeedsPerToken(token);
        }
      }
    }
  }
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

  for (let i = 0; i < depositors.length; i += BATCH_SIZE) {
    const batch = depositors.slice(i, Math.min(i + BATCH_SIZE, depositors.length));
    await Promise.all(batch.map(depositor => checkWallet(results, deposits, depositor)));
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

async function checkWallet(results, deposits, depositor) {

  accountUpdates[depositor] = await bs.s.a[depositor].lastUpdate;
  results[depositor] = { breakdown: {} };

  let netDepositorStalk = 0n;
  for (const token in deposits[depositor]) {
    if (token == 'totals') {
      continue;
    }

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
      if (deposits[depositor][token][stem].version === 'season') {
        mowStem = seasonToStem(accountUpdates[depositor], getLegacySeedsPerToken(token));
      }
      const stemDelta = mowStem - BigInt(stem);
      // Deposit stalk = grown + base stalk
      // stems have 6 precision, though 10 is needed to grow one stalk. 10 + 6 - 6 => 10 precision for stalk
      netTokenStalk += (stemDelta + 10000000000n) * deposits[depositor][token][stem].bdv / BigInt(10 ** 6);
      undivided += (stemDelta + 10000000000n) * deposits[depositor][token][stem].bdv;
      // console.log(`token: ${token}, stem: ${stem}${deposits[depositor][token][stem].version !== 'v3.1' ? '(scaled)' : ''}, mowStem: ${mowStem}, bdv: ${deposits[depositor][token][stem].bdv}`);
    }
    netDepositorStalk += netTokenStalk;
    results[depositor].breakdown[token] = netTokenStalk;
    // console.log('undivided result', netTokenStalk, undivided / BigInt(10 ** 6));
  }

  results[depositor].depositStalk = netDepositorStalk;
  results[depositor].contractStalk = await getContractStalk(depositor);
  results[depositor].discrepancy = results[depositor].depositStalk - results[depositor].contractStalk;

  if (Object.values(deposits[depositor].totals).some(v => v.seeds > 0n)) {
    results[depositor].depositSeeds = Object.values(deposits[depositor].totals).reduce(
      (ans, next) => ans + next.seeds, 0n);
    results[depositor].contractSeeds = await bs.s.a[depositor].s.seeds;
    results[depositor].seedsDiscrepancy = results[depositor].depositSeeds - results[depositor].contractSeeds;
  }

  process.stdout.write(`\r${++walletProgress} / ${Object.keys(deposits).length}`);
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
  stemStartSeason = await bs.s.season.stemStartSeason;
  stemScaleSeason = await bs.s.season.stemScaleSeason;

  // https://dune.com/queries/3819175
  const fileStream = fs.createReadStream(`${__dirname}/data/stems/deposit-stems${dataFile}.csv`);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const deposits = {};
  console.log('Reading deposits data from file');
  WALLET_LIMIT && console.log('WALLET_LIMIT:', WALLET_LIMIT);

  let linesBuffer = [];
  for await (const line of rl) {
    if (!line.includes('account') && (!specificWallet || line.includes(specificWallet))) {
      linesBuffer.push(line);
    }
    if (linesBuffer.length >= BATCH_SIZE) {
      await preProcessInit(deposits, linesBuffer);
      await Promise.all(linesBuffer.map(line => processLine(deposits, line)));
      linesBuffer = [];
    }
  }
  if (linesBuffer.length > 0) {
    await preProcessInit(deposits, linesBuffer);
    await Promise.all(linesBuffer.map(line => processLine(deposits, line)));
  }
  calcDepositTotals(deposits);
  if (specificWallet) {
    console.log(JSON.stringify(deposits, bigintDecimal, 2));
  }
  process.stdout.write('\n');
  console.log(`Finished processing ${parseProgress} entries`);
  if (!specificWallet) {
    await fs.promises.writeFile(`results/stalk-audit/stalk-audit-deposits${dataFile}.json`, JSON.stringify(deposits, bigintDecimal, 2));
  }

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

function findSeasonsDiscrepancies() {
  const deposits = require('../../results/stalk-audit/stalk-audit-deposits20136600.json');
  const audit = require('../../results/stalk-audit/stalk-audit-formatted20136600.json');

  for (const entry of audit) {
    if (!entry[1].raw.discrepancy.startsWith("-")) {
      if (JSON.stringify(deposits[entry[0]]).includes("season")) {
        console.log('found account', entry[0]);
      }
    }
  }
}
// findSeasonsDiscrepancies();
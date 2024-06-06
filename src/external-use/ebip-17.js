const { BEAN, BEANSTALK } = require("../addresses");
const { asyncBeanstalkContractGetter } = require("../datasources/contract-function");
const { beanstalkSG, gql } = require("../datasources/subgraph/subgraph-query");
const { providerThenable } = require("../provider");
const fs = require('fs');
const { BigNumber } = require('alchemy-sdk');

const ContractStorage = require("../datasources/storage/contract-storage");
const storageLayout = require('../contracts/beanstalk/storageLayout.json');

// EBIP-17 is necessary to correct the earned beans issue resolved by EBIP-16

async function depsositedIncludingGerminating(block) {
  const beanstalk = await asyncBeanstalkContractGetter();
  const deposited = await beanstalk.callStatic.getTotalDeposited(BEAN, { blockTag: block });
  const germinating = await beanstalk.callStatic.getGerminatingTotalDeposited(BEAN, { blockTag: block });
  const contractResult = deposited.add(germinating);
  
  const sgResult = await beanstalkSG(gql`
    {
      siloAsset(
        id: "0xc1e088fc1323b20bcbee9bd1b9fc9546db5624c5-0xbea0000029ad1c77d3d5d23ba2d8893db9d1efab"
        block: {number: ${block}}
      ) {
        depositedAmount
      }
    }
  `);

  const contractNum = contractResult.toNumber();
  const sgNum = parseInt(sgResult.siloAsset.depositedAmount);

  return contractNum - sgNum;

  // This was originally used to identify the first occurrence via a binary search, no longer needed
  // if (contractNum != sgNum) {
  //     console.log('contract: ', contractNum);
  //     console.log(germinating.toNumber());
  //     console.log('subgraph: ', sgNum);
  //     console.log('difference: ', contractNum - sgNum);
  //     return -1;
  // } else {
  //     return 1;
  // }
}

// `roots = s.s.roots.mul(stalk).div(s.s.stalk);`, which we need to remove from both the user and the global s.s.roots.
// To calculate the amount of roots which should have been removed, we need to use the would-be correct values
// for s.s.roots and s.s.stalk. so this will be something like
// `roots = (s.s.roots - cumulativeRootDiscrepancy)*(userStalkDiscrepancy)/(s.s.stalk - cumulativeStalkDiscrepancy)`.
// we then subtract that value from the user roots, and add it onto cumulativeDiscrepancyRoots for the next one,
// also adding onto cumulativeDiscrepancyStalk for the next one
async function appendResults(results, block, userBdvDiscrepancy) {

  const provider = await providerThenable;
  const bs = new ContractStorage(provider, BEANSTALK, storageLayout, block);

  const blockData = await provider.getBlockWithTransactions(block);
  const transactions = blockData.transactions.filter(tx => tx.to && tx.to.toLowerCase() === BEANSTALK.toLowerCase()
      // These two txns occurred on the same block as some of the discrepancy txns.
      // Manually omitted from the result for simplicity. The first is a deposit, the second is a sunrise.
      && tx.hash !== '0x03f0efe504486671a0583ac0bf96ebe593cd92eec4fac71fb6a12a3e58c20672'
      && tx.hash !== '0xb994038d84894c297a33df433d92799ff45012d1d3e08d402aa9b3e6fb96478b');
  
  if (transactions.length !== 1) {
    throw new Error(`There is a missing or an extra transaction at block ${issue.block}, ${transactions.length}`);
  }

  const userAccount = transactions[0].from.toLowerCase();

  const prevResult = results[results.length - 1];
  const cumulativeBdvDiscrepancy = prevResult?.cumulativeDiscrepancy?.depositedBean ?? 0;
  const cumulativeStalkDiscrepancy = prevResult?.cumulativeDiscrepancy?.stalk ?? 0;
  const cumulativeRootDiscrepancy = prevResult?.cumulativeDiscrepancy?.roots ?? BigNumber.from(0);

  const userStalkDiscrepancy = userBdvDiscrepancy * Math.pow(10, 4); // 6 -> 10 decimals

  let userRootDiscrepancy =
      (await bs.s.s.roots).sub(cumulativeRootDiscrepancy).mul(BigNumber.from(userStalkDiscrepancy))
      .div((await bs.s.s.stalk).sub(BigNumber.from(cumulativeStalkDiscrepancy)));

  // Verify that this would not result in the user having negative roots
  const userCurrentRoots = await bs.s.a[userAccount].roots;
  if (userRootDiscrepancy.gt(userCurrentRoots)) {
    console.log(`User has more roots than calculated ${userRootDiscrepancy} ${userCurrentRoots}`);
    userRootDiscrepancy = userCurrentRoots;
  }

  results.push({
    account: userAccount,
    accountDiscrepancy: {
      depositedBean: userBdvDiscrepancy,
      depositedBdv: userBdvDiscrepancy,
      stalk: userStalkDiscrepancy,
      roots: userRootDiscrepancy
    },
    cumulativeDiscrepancy: {
      depositedBean: cumulativeBdvDiscrepancy + userBdvDiscrepancy,
      depositedBdv: cumulativeBdvDiscrepancy + userBdvDiscrepancy,
      stalk: cumulativeStalkDiscrepancy + userStalkDiscrepancy,
      roots: cumulativeRootDiscrepancy.add(userRootDiscrepancy)
    },
    block,
    txHash: transactions[0].hash
  });
}

// For filling results from a known set of blocks having the issue.
// Includes a check for verifying that no blocks were missed in between.
async function prefillKnownResults(results, knownBlocks) {

  let lastDiff = 0;
  for (let i = 0; i < knownBlocks.length; ++i) {
    const b = knownBlocks[i];
    // Verify the set of known blocks is complete by checking the prior block for equality
    const prevBlockDiff = await depsositedIncludingGerminating(b - 1);
    if (prevBlockDiff !== lastDiff) {
      throw new Error(`Missing at least one transaction before saved block ${b}`)
    }

    const newDiff = await depsositedIncludingGerminating(b);
    if (lastDiff === newDiff) {
      throw new Error(`There was no difference encountered in saved block ${b}`)
    }
    const userBdvDiscrepancy = newDiff - lastDiff;
    // console.log(`block: ${b}, error: ${userBdvDiscrepancy}`);
    lastDiff = newDiff;

    // Add to the results list
    await appendResults(results, b, userBdvDiscrepancy);
    console.log(`${i + 1} / 35`);
  }
  
  return lastDiff;
}

// No longer needed
async function fillResults(results, lastDiff, startBlock, endBlock) {

  let canSkip100 = true;
  for (let i = startBlock; i < endBlock + 100; ) {
    const newDiff = await depsositedIncludingGerminating(i);
    if (lastDiff != newDiff) {
      if (canSkip100) {
        canSkip100 = false;
        i -= 100;
        continue;
      }
      canSkip100 = true;
      const userBdvDiscrepancy = newDiff - lastDiff;
      console.log('found discrepancy for block', i, newDiff - lastDiff);
      lastDiff = newDiff;
      
      appendResults(results, i, userBdvDiscrepancy);
    }
    if (i % 100 == 0) {
      console.log(i);
    }

    if (canSkip100) {
      i += 100;
    } else {
      ++i;
    }
  }
}

(async () => {

  const known = [
    19941969, 19942000, 19942640, 19943955, 19944606, 19944956, 19946180, 19946460, 19946615, 19947349, 19953632,
    19956101, 19956694, 19957438, 19957455, 19957739, 19962793, 19962879, 19963829, 19964305, 19966550, 19967148,
    19968983, 19969909, 19972427, 19974811, 19976352, 19980662, 19983194, 19983874, 19983878, 19985609, 19993199,
    19994008, 20000251
  ];
  let results = [];

  console.log('Identifying affected blocks and amounts...');
  let lastDiff = await prefillKnownResults(results, known);

  // This part is not necessary since all have been identified through ebip-16
  // await fillResults(results, lastDiff, known[known.length - 1] + 1, 20000923);

  let affectedAccounts = [];

  // Count the affected accounts
  for (const result of results) {
    if (!affectedAccounts.includes(result.account)) {
      affectedAccounts.push(result.account);
    }
  }

  console.log(`-----------------------------------------------`);
  console.log(`Total depositedAmount discrepancy: ${lastDiff}`);
  console.log(`Total erroneous transactions: ${results.length}`);
  console.log(`Total affected accounts: ${affectedAccounts.length}`);
  console.log(`-----------------------------------------------`);
  console.log(`Results outputted to results/ebip-17.json`);
  
  await fs.promises.writeFile('results/ebip-17.json', JSON.stringify(results, null, 2));

})();

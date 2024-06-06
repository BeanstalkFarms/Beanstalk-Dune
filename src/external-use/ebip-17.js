const { BEAN, BEANSTALK } = require("../addresses");
const { asyncBeanstalkContractGetter } = require("../datasources/contract-function");
const { beanstalkSG, gql } = require("../datasources/subgraph/subgraph-query");
const { providerThenable } = require("../provider");
const fs = require('fs');

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

// For filling results from a known set of blocks having the issue.
// Includes a check for verifying that no blocks were missed in between.
async function prefillKnownResults(results, knownBlocks) {

  let lastDiff = 0;
  for (const b of knownBlocks) {
    // Verify the set of known blocks is complete by checking the prior block for equality
    const prevBlockDiff = await depsositedIncludingGerminating(b - 1);
    if (prevBlockDiff !== lastDiff) {
      throw new Error(`Missing at least one transaction before saved block ${b}`)
    }

    const newDiff = await depsositedIncludingGerminating(b);
    if (lastDiff === newDiff) {
      throw new Error(`There was no difference encountered in saved block ${b}`)
    }
    const userDiscrepancy = newDiff - lastDiff;
    // console.log(`block: ${b}, error: ${userDiscrepancy}`);
    lastDiff = newDiff;

    results.push({
      block: b,
      userDiscrepancy,
      cumulativeDiscrepancy: newDiff
    });
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
      console.log('found discrepancy for block', i, newDiff - lastDiff);
      lastDiff = newDiff;
      
      results.push({
        block: i
      });
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

  // This part is a noop since all have been identified.
  await fillResults(results, lastDiff, known[known.length - 1] + 1, 20000923);

  console.log('Identifying transactions and accounts...');
  let affectedAccounts = [];

  const provider = await providerThenable;
  const withTxData = await Promise.all(results.map(async issue => {
    const blockData = await provider.getBlockWithTransactions(issue.block);
    const transactions = blockData.transactions.filter(tx => tx.to && tx.to.toLowerCase() === BEANSTALK.toLowerCase()
        // These two txns occurred on the same block as some of the discrepancy txns.
        // Manually omitted from the result for simplicity. The first is a deposit, the second is a sunrise.
        && tx.hash !== '0x03f0efe504486671a0583ac0bf96ebe593cd92eec4fac71fb6a12a3e58c20672'
        && tx.hash !== '0xb994038d84894c297a33df433d92799ff45012d1d3e08d402aa9b3e6fb96478b');
    
    if (transactions.length !== 1) {
      throw new Error(`There is a missing or an extra transaction at block ${issue.block}, ${transactions.length}`);
    }
    if (!affectedAccounts.includes(transactions[0].from.toLowerCase())) {
      affectedAccounts.push(transactions[0].from.toLowerCase());
    }

    return {
      ...issue,
      txHash: transactions[0].hash,
      account: transactions[0].from.toLowerCase()
    };
  }));

  // Sort block ascending
  withTxData.sort((a, b) => a.block - b.block);

  console.log(`-----------------------------------------------`);
  console.log(`Total depositedAmount discrepancy: ${lastDiff}`);
  console.log(`Total erroneous transactions: ${withTxData.length}`);
  console.log(`Total affected accounts: ${affectedAccounts.length}`);
  console.log(`-----------------------------------------------`);
  console.log(`Results outputted to results/ebip-17.json`);
  

  await fs.promises.writeFile('results/ebip-17.json', JSON.stringify(withTxData, null, 2));

})();

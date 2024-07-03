const fs = require('fs');
const readline = require('readline');
const { BEANSTALK, FERTILIZER } = require('../addresses.js');
const { getContractAsync } = require("../datasources/contract-function")
const fertAbi = require('../contracts/beanstalk/fertilizer.json');

const BATCH_SIZE = 100;

let checkProgress = 0;

let fert;
let sumFertEvent = BigInt(0);
let sumFertContract = BigInt(0);
let sumFertBreakdown = {};

async function checkBalance(line) {
  const [_, account, _1, eventAmount, _2, id] = line.split(',');

  const contractAmount = await fert.callStatic.balanceOf(account, id);

  if (BigInt(eventAmount) != BigInt(contractAmount)) {
    console.log(`Balance of id ${id} for farmer ${account} was not ${eventAmount}! (was ${contractAmount})`);
  }
  sumFertEvent += BigInt(eventAmount);
  sumFertContract += BigInt(contractAmount);
  if (!sumFertBreakdown[id]) {
    sumFertBreakdown[id] = {
      'event': BigInt(0),
      'contract': BigInt(0)
    };
  }
  sumFertBreakdown[id].event += BigInt(eventAmount);
  sumFertBreakdown[id].contract += BigInt(contractAmount);

  process.stdout.write(`\r${++checkProgress} / ?`);
}

(async () => {

  fert = await getContractAsync(FERTILIZER, fertAbi);

  // https://dune.com/queries/3526214
  const fileStream = fs.createReadStream(`${__dirname}/data/fert.csv`);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let linesBuffer = [];
  for await (const line of rl) {
    if (!line.includes('account')) {
      linesBuffer.push(line);
    }
    if (linesBuffer.length >= BATCH_SIZE) {
      await Promise.all(linesBuffer.map(checkBalance));
      linesBuffer = [];
    }
  }
  if (linesBuffer.length > 0) {
    await Promise.all(linesBuffer.map(checkBalance));
  }

  console.log(`Total Fert (sum of events):    ${sumFertEvent}`);
  console.log(`Total Fert (sum of balanceOf): ${sumFertContract}`);

})()
const fs = require('fs');
const { BEANSTALK } = require('../addresses.js');
const storageLayout = require('../contracts/beanstalk/storageLayout.json');
const ContractStorage = require('../datasources/storage/src/contract-storage');
const { beanstalkSG } = require("../datasources/subgraph/subgraph-query")
const { allPaginatedSG } = require("../datasources/subgraph/subgraph-paginate");
const { providerThenable } = require('../provider');

const EXPORT_BLOCK = 20000000;

let checkProgress = 0;

let sumHarvested = BigInt(0);
let sumUnharvested = BigInt(0);

const unharvestedHarvestable = [];

// Retrieve all plots
async function getAllPlots(block) {

  return await allPaginatedSG(
    beanstalkSG,
    `
      {
        plots {
          id
          index
          pods
          harvestedPods
          harvestablePods
          farmer {
            id
          }
        }
      }
    `,
    `block: {number: ${block}}`,
    '',
    ['index'],
    [0],
    'asc'
  );
}

async function checkPlot(plot) {
  if (plot.harvestedPods == '0') {
    const contractPlotAmount = await bs.s.a[plot.farmer.id].field.plots[plot.index];
    if (BigInt(plot.pods) != contractPlotAmount) {
      console.log(`Plot at index ${plot.index} for farmer ${plot.farmer.id} was not ${plot.pods}!`);
    }
    if (plot.harvestablePods != '0') {
      sumUnharvested += BigInt(plot.harvestablePods);
      unharvestedHarvestable.push(plot);
    }
  } else {
    sumHarvested += BigInt(plot.harvestedPods);
  }
  process.stdout.write(`\r${++checkProgress}`);
}

(async () => {

  bs = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, EXPORT_BLOCK);

  const plotCache = `cache/field-plots${EXPORT_BLOCK}.json`;
  let allPlots;
  if (fs.existsSync(plotCache)) {
    allPlots = JSON.parse(fs.readFileSync(plotCache));
    console.log(`Loaded ${allPlots.length} cached plots`);
  } else {
    console.log(`No cached plots, querying subgraph...`);

    allPlots = await getAllPlots(EXPORT_BLOCK);
    console.log(`Found ${allPlots.length} plots`);

    await fs.promises.writeFile(plotCache, JSON.stringify(allPlots, null, 2));
    console.log(`Wrote plots to ${plotCache}`);
  }

  // Sum the total amount of pods
  let totalPods = BigInt(0);
  for (const plot of allPlots) {
    totalPods += BigInt(plot.pods);
  }

  console.log(`Total Pods (s.f.pods):     ${await bs.s.f.pods}`);
  console.log(`Total Pods (sum of plots): ${totalPods}`);
  console.log('-------------------------------------------');

  // Check that each account owns each plot/amount
  const BATCH_SIZE = 100;
  const allPromiseGenerators = allPlots.map((plot) => () => checkPlot(plot));
  process.stdout.write(`\r0${' '.repeat(allPlots.length.toString().length - 1)} / ${allPlots.length}`);
  while (allPromiseGenerators.length > 0) {
    await Promise.all(allPromiseGenerators.splice(0, Math.min(BATCH_SIZE, allPromiseGenerators.length)).map(p => p()));
  }

  console.log(`\rTotal Harvestable Pods (s.f.harvestable):              ${await bs.s.f.harvestable}`);
  console.log(`\rTotal Unharvestable Pods (s.f.pods - s.f.harvestable): ${await bs.s.f.pods - await bs.s.f.harvestable}`);
  console.log(`\rTotal Harvested Pods (sum of plots):                   ${sumHarvested}`);
  console.log(`\rTotal Unharvested Pods (sum of plots):                 ${sumUnharvested}`);
  console.log('-------------------------------------------');

  console.log('The following plots are harvestable:');
  console.log(JSON.stringify(unharvestedHarvestable, null, 2));

})()
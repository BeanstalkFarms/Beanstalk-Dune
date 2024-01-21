const { alchemy } = require('../provider.js');
const { initResultsTable, addContractResults, initResultFile, appendResults } = require('./table-builder.js');
const { getLastProcessed } = require('./cursor.js');
const { getBeanstalkContractAsync } = require('../contracts/contracts.js');

// Fertilizer is only relevant since the barn raise
const FERT_DEPLOYMENT = 14910573;
const REPLANT_FERTILIZATION = 15279874;

/*
    For now, intentionally leaving out some fields which may be of interest. It will be necessary
    to implement support for easily adding new columns to already processed entries.
*/
const FILE_NAME = 'fertilizer';
const HEADER = 'sprouts_paid,sprouts_unpaid,sprouts_incurred,fert_active,bpf,fert_available,recap_percent'
const CONTRACT_INVOCATIONS = [
    {
        // Sprouts paid back so far
        name: 'totalFertilizedBeans',
        contractThenable: getBeanstalkContractAsync,
        transformation: x => x.toNumber()
    },
    {
        // Unpaid sprouts (not including unsold Fertilizer)
        name: 'totalUnfertilizedBeans',
        contractThenable: getBeanstalkContractAsync,
        transformation: x => x.toNumber()
    },
    {
        // Total sprout debt incurred so far
        name: 'totalFertilizerBeans',
        contractThenable: getBeanstalkContractAsync,
        transformation: x => x.toNumber()
    },
    {
        // Amount of active fertilizer
        name: 'getActiveFertilizer',
        contractThenable: getBeanstalkContractAsync,
        transformation: x => x.toNumber()
    },
    {
        // Amount of beans paid out to each bought fertilizer
        name: 'beansPerFertilizer',
        contractThenable: getBeanstalkContractAsync,
        transformation: x => x.toNumber()
    },
    {
        // Available fertilizer for purchase
        name: 'remainingRecapitalization',
        contractThenable: getBeanstalkContractAsync,
        transformation: x => x.toNumber()
    }
];

async function buildFertilizer() {

    // TODO: consider how to handle sitations where those functions do not exist yet.
    //  could use nulls, or could use different ABI altogether for different block ranges.
    // await appendBlock(FERT_DEPLOYMENT);

    // TODO: consider how each table should configure this value
    const end = await alchemy.core.getBlockNumber();

    const FREQUENCY = 300;
    const lastProcessed = getLastProcessed(FILE_NAME);
    const blockForIteration = (i) => (lastProcessed === -1 ? REPLANT_FERTILIZATION : lastProcessed + FREQUENCY) + FREQUENCY*i;
    for (let i = 0; blockForIteration(i) < end; ++i) {
        console.log(`${new Date().toISOString()}: fertilizer.analyzeBlock(${blockForIteration(i)})`);
        await analyzeBlock(blockForIteration(i));
    }
    return FILE_NAME;
}

async function analyzeBlock(blockNumber) {

    const table = await initResultsTable(blockNumber);

    // Firstly get some information from the contracts directly
    await addContractResults(table, CONTRACT_INVOCATIONS, blockNumber);

    // Computed values: recapitalization percentage
    const recapPercent = table.getActiveFertilizer / (table.getActiveFertilizer + table.remainingRecapitalization / Math.pow(10, 6));
    table.push(recapPercent, 'recapPercent');
    
    await appendResults(FILE_NAME, table);
}

(async function init() {
    await initResultFile(FILE_NAME, HEADER);
})();

module.exports = {
    buildFertilizer: buildFertilizer
};

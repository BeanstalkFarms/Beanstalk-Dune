const { initResultsTable, addContractResults, initResultFile, appendResults } = require('./table-builder.js');
const { getLastProcessed } = require('./cursor.js');
const { getBeanstalkContractAsync } = require('../contracts/contracts.js');

// Fertilizer is only relevant since the barn raise
const FERT_DEPLOYMENT = 14910573;
const REPLANT = 15278963;

/* 
    For now, intentionally leaving out some fields which may be of interest. It will be necessary
    to implement support for easily adding new columns to already processed entries.
*/
const FILE_NAME = 'fertilizer';
const HEADER = 'sprouts_paid,sprouts_unpaid,sprouts_incurred,fert_sold,bpf,fert_available,recap_percent'
const CONTRACT_INVOCATIONS = [
    {
        // Sprouts paid back so far
        name: 'totalFertilizedBeans',
        transformation: x => x.toNumber()
    },
    {
        // Unpaid sprouts (not including unsold Fertilizer)
        name: 'totalUnfertilizedBeans',
        transformation: x => x.toNumber()
    },
    {
        // Total sprout debt incurred so far
        name: 'totalFertilizerBeans',
        transformation: x => x.toNumber()
    },
    {
        // Amount of fertilizer which has been sold
        name: 'getActiveFertilizer',
        transformation: x => x.toNumber()
    },
    {
        // Amount of beans paid out to each bought fertilizer
        name: 'beansPerFertilizer',
        transformation: x => x.toNumber()
    },
    {
        // Available fertilizer for purchase
        name: 'remainingRecapitalization',
        transformation: x => x.toNumber()
    }
];

async function buildFertilizer() {

    // TODO: consider how to handle sitations where those functions do not exist yet.
    //  could use nulls, or could use different ABI altogether for different block ranges.
    // await appendBlock(FERT_DEPLOYMENT);

    const FREQUENCY = 300;
    const lastProcessed = getLastProcessed(FILE_NAME);
    const nextBlock = lastProcessed === -1 ? REPLANT : lastProcessed + FREQUENCY;
    for (let i = 0; i < 5; ++i) {
        await appendBlock(nextBlock + FREQUENCY*i);
    }
}

async function appendBlock(blockNumber) {

    const table = await initResultsTable(blockNumber);

    // Firstly get some information from the contracts directly
    await addContractResults(table, await getBeanstalkContractAsync(), CONTRACT_INVOCATIONS, blockNumber);

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

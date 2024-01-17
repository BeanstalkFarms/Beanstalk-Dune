const { alchemy } = require('../provider.js');
const { initResultsTable, addContractResults, initResultFile, appendResults } = require('./table-builder.js');
const { getLastProcessed } = require('./cursor.js');
const { getBeanstalkContractAsync } = require('../contracts/contracts.js');
const { UNRIPE_BEAN, UNRIPE_LP } = require('../addresses.js');

const REPLANT = 15278963;

const FILE_NAME = 'unripe';
const HEADER = 'percent_beans_recapped,percent_lp_recapped'
const CONTRACT_INVOCATIONS = [
    {
        name: 'getRecapFundedPercent',
        parameters: [UNRIPE_BEAN],
        transformation: x => x / Math.pow(10, 6)
    },
    {
        // Unpaid sprouts (not including unsold Fertilizer)
        name: 'getRecapFundedPercent',
        parameters: [UNRIPE_LP],
        transformation: x => x / Math.pow(10, 6)
    }
];

async function buildUnripe() {

    // TODO: consider how each table should configure this value
    const end = await alchemy.core.getBlockNumber();

    const FREQUENCY = 25000;
    const lastProcessed = getLastProcessed(FILE_NAME);
    const blockForIteration = (i) => (lastProcessed === -1 ? REPLANT : lastProcessed + FREQUENCY) + FREQUENCY*i;
    for (let i = 0; blockForIteration(i) < end; ++i) {
        try {
            console.log(`${new Date().toISOString()}: unripe.analyzeBlock(${blockForIteration(i)})`);
            await analyzeBlock(blockForIteration(i));
        } catch (e) {
            // This might not be necessary anymore now that retryable was added
            console.log('encountered exception, continuing:', e);
            --i;
        }
    }
    return FILE_NAME;
}

async function analyzeBlock(blockNumber) {

    const table = await initResultsTable(blockNumber);

    await addContractResults(table, await getBeanstalkContractAsync(), CONTRACT_INVOCATIONS, blockNumber);
    
    await appendResults(FILE_NAME, table);
}

(async function init() {
    await initResultFile(FILE_NAME, HEADER);
})();

module.exports = {
    buildUnripe: buildUnripe
};

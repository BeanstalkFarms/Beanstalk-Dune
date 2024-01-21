const { alchemy } = require('../provider.js');
const { initResultsTable, addContractResults, initResultFile, appendResults } = require('./table-builder.js');
const { getLastProcessed } = require('./cursor.js');
const { getBeanstalkContractAsync, createAsyncERC20ContractGetter } = require('../contracts/contracts.js');
const { UNRIPE_BEAN, UNRIPE_LP } = require('../addresses.js');

const REPLANT_FERTILIZATION = 15279874;

const FILE_NAME = 'unripe';
const HEADER = 'urbean_supply,urbean_underlying_one,urbean_chop_penalty,urbean_recap_funded_percent,urbean_percent_penalty,urbean_penalized_underlying,urbean_total_underlying,urlp_supply,urlp_underlying_one,urlp_chop_penalty,urlp_recap_funded_percent,urlp_percent_penalty,urlp_penalized_underlying,urlp_total_underlying,urlp_underlying_token'
const CONTRACT_INVOCATIONS = [
    {
        name: 'totalSupply',
        contractThenable: createAsyncERC20ContractGetter(UNRIPE_BEAN),
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getUnderlyingPerUnripeToken',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_BEAN],
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getPenalty',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_BEAN],
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getRecapFundedPercent',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_BEAN],
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getPercentPenalty',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_BEAN],
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getPenalizedUnderlying',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_BEAN, 1 * Math.pow(10, 6)],
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getTotalUnderlying',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_BEAN],
        transformation: x => x / Math.pow(10, 6)
    },
    // Underyling LP tokens (BEAN3CRV and BEANETH) have 18 decimals
    {
        name: 'totalSupply',
        contractThenable: createAsyncERC20ContractGetter(UNRIPE_LP),
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getUnderlyingPerUnripeToken',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_LP],
        transformation: x => x / Math.pow(10, 18)
    },
    {
        name: 'getPenalty',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_LP],
        transformation: x => x / Math.pow(10, 18)
    },
    {
        name: 'getRecapFundedPercent',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_LP],
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getPercentPenalty',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_LP],
        transformation: x => x / Math.pow(10, 6)
    },
    {
        name: 'getPenalizedUnderlying',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_LP, 1 * Math.pow(10, 6)],
        transformation: x => x / Math.pow(10, 18)
    },
    {
        name: 'getTotalUnderlying',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_LP],
        transformation: x => x / Math.pow(10, 18)
    },
    {
        name: 'getUnderlyingToken',
        contractThenable: getBeanstalkContractAsync,
        parameters: [UNRIPE_LP]
    }
];

async function buildUnripe() {

    // TODO: consider how each table should configure this value
    const end = await alchemy.core.getBlockNumber();

    const FREQUENCY = 25000;
    const lastProcessed = getLastProcessed(FILE_NAME);
    const blockForIteration = (i) => (lastProcessed === -1 ? REPLANT_FERTILIZATION : lastProcessed + FREQUENCY) + FREQUENCY*i;
    for (let i = 0; blockForIteration(i) < end; ++i) {
        console.log(`${new Date().toISOString()}: unripe.analyzeBlock(${blockForIteration(i)})`);
        await analyzeBlock(blockForIteration(i));
    }
    return FILE_NAME;
}

async function analyzeBlock(blockNumber) {

    const table = await initResultsTable(blockNumber);

    await addContractResults(table, CONTRACT_INVOCATIONS, blockNumber);
    
    await appendResults(FILE_NAME, table);
}

(async function init() {
    await initResultFile(FILE_NAME, HEADER);
})();

module.exports = {
    buildUnripe: buildUnripe
};

const { alchemy } = require('../provider.js');
const fs = require('fs');

// These two will always be the first entries of every table
const HEADER_PREFIX = 'block,timestamp,';

// Allow store the result in this array using an optional name for convenience
async function initResultsTable(blockNumber = 'latest') {

    const results = [];
    results.push = (item, name) => {
        Array.prototype.push.call(results, item);
        name && (results[name] = item);
    }
    const blockInfo = await alchemy.core.getBlock(blockNumber);
    results.push(blockInfo.number, 'block');
    results.push(new Date(blockInfo.timestamp * Math.pow(10, 3)).toISOString(), 'timestamp');
    return results;
}

/**
 * Helper for building tables using results from contract view function
 * invocations array should follow this format:
 * [
 *   {
 *     name: 'nameOfTheContractFunction',
 *     (optional) parameters: ['list of parameters', 'to the contract function'],
 *     (optional) transformation: (x) => `transforms the contract's result ${x}`
 *   }
 * ]
 */
async function addContractResults(results, contract, invocations, blockNumber = 'latest') {

    for (invocation of invocations) {
        const contractResult = await contract.callStatic[invocation.name](...(invocation.parameters ?? []), { blockTag: blockNumber });
        const transformedResult = invocation.transformation?.(contractResult) ?? contractResult;
        results.push(transformedResult, invocation.name);
    }
    return results;
}

// First time setup of a file with the appropriate header
async function initResultFile(fileName, header) {
    const filePath = `results/${fileName}.csv`;
    if (!fs.existsSync(filePath)) {
        await fs.promises.appendFile(`results/${fileName}.csv`, HEADER_PREFIX + header + '\n');
    }
}

async function appendResults(fileName, result) {
    await fs.promises.appendFile(`results/${fileName}.csv`, result.join(',') + '\n');
}

module.exports = {
    initResultsTable: initResultsTable,
    addContractResults: addContractResults,
    initResultFile: initResultFile,
    appendResults: appendResults
};

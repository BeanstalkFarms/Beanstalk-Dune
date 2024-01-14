const { alchemy } = require('../provider.js');
const { setLastProcessed } = require('./cursor.js');
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

// TODO: move this code elsewhere
const timeoutPromise = (timeLimitMs) => new Promise((resolve, reject) => setTimeout(() => reject(new Error('Promise exceeded time limit')), timeLimitMs));
function retryable(asyncFunction, timeLimitMs = 10000, retryCount = 2) {
    if (retryCount < 0) {
        return Promise.reject(new Error('Exceeded retry count'));
    }
    return new Promise((resolve, reject) => {
        Promise.race([asyncFunction(), timeoutPromise(timeLimitMs)])
                // asyncFunction was successful
                .then(resolve)
                // asyncFunction failed or timed out, retry
                .catch((e) => {
                    console.log('[retryable] Error encountered, retrying: ', retryCount - 1, e);
                    retryable(asyncFunction, timeLimitMs, retryCount - 1).then(resolve).catch(reject);
                });
    });
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

    const promises = [];
    for (invocation of invocations) {
        promises.push(
            retryable(
                () => contract.callStatic[invocation.name](...(invocation.parameters ?? []), { blockTag: blockNumber }),
                2000
            )
        );
    }
    const resolved = await Promise.all(promises);
    for (let i = 0; i < invocations.length; ++i) {
        const transformedResult = invocations[i].transformation?.(resolved[i]) ?? resolved[i];
        results.push(transformedResult, invocations[i].name);
    }
    return results;
}

// First time setup of a file with the appropriate header
async function initResultFile(fileName, header) {
    const filePath = `results/${fileName}.csv`;
    if (!fs.existsSync(filePath)) {
        await fs.promises.appendFile(filePath, HEADER_PREFIX + header + '\n');
    }
}

async function appendResults(fileName, result) {
    await fs.promises.appendFile(`results/${fileName}.csv`, result.join(',') + '\n');
    await setLastProcessed(fileName, result.block);
}

module.exports = {
    initResultsTable: initResultsTable,
    addContractResults: addContractResults,
    initResultFile: initResultFile,
    appendResults: appendResults
};

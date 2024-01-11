// Allow store the result in this array using an optional name for convenience
function initResultsTable() {

    const results = [];
    results.push = (item, name) => {
        Array.prototype.push.call(results, item);
        name && (results[name] = item);
    }
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

module.exports = {
    initResultsTable: initResultsTable,
    addContractResults: addContractResults
};

const { alchemy } = require('./provider.js');
const { BEANSTALK, BEAN, PEPE } = require('./addresses.js');
const { getBeanstalkContractAsync, getBalance } = require('./contracts/contracts.js');
const { uploadCsv } = require('./dune-export.js');
const { buildFertilizer } = require('./tables/fertilizer.js');
const { buildUnripe } = require('./tables/unripe.js');

async function logTestInfo() {
    // recent mints started: 18963933
    const harvestableNow = await getBeanstalkContractAsync().then(bc => bc.callStatic.harvestableIndex());
    const harvestableThen = await getBeanstalkContractAsync().then(bc => bc.callStatic.harvestableIndex({blockTag: 18963933}));
    const beanBalance = await getBalance(BEAN, BEANSTALK);
    const pepeBalance = await getBalance(PEPE, BEANSTALK);
    console.log(`Harvestable index: ${harvestableNow}\nOlder harvestable index: ${harvestableThen}\nBEAN: ${beanBalance}\nPEPE: ${pepeBalance}`);
}
// logTestInfo();
// uploadCsv('sample');
(async () => {
    await buildFertilizer().then(uploadCsv);
    await buildUnripe().then(uploadCsv);
})();


// TODO:
// Some class structure abstracting boilerplate for the various tables (i.e. fertilizer/unripe.js)
// Proof of concept using subgraph
// Proof of concept accessing variables from diamond storage directly (not needing a view function)
// Have some recognition of block number -> which ABI to use, or when to stop, and handling when functions dont exist
// Support for adjusting columns/reiterating and adding to existing datasets rather than having to recreate everything
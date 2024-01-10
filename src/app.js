const { alchemy } = require('./provider.js');
const { BEANSTALK, BEAN, PEPE } = require('./addresses.js');
const { getBeanstalkContractAsync, getBalance } = require('./contracts/contracts.js');
const { uploadCsv } = require('./dune-export.js');

// recent mints: 18963933

async function logTestInfo() {
    const harvestableNow = await getBeanstalkContractAsync().then(bc => bc.harvestableIndex());
    const harvestableThen = await getBeanstalkContractAsync().then(bc => bc.harvestableIndex({blockTag: 18963933}));
    const beanBalance = await getBalance(BEAN, BEANSTALK);
    const pepeBalance = await getBalance(PEPE, BEANSTALK);
    console.log(`Harvestable index: ${harvestableNow}\nOlder harvestable index: ${harvestableThen}\nBEAN: ${beanBalance}\nPEPE: ${pepeBalance}`);
}
logTestInfo();
uploadCsv('sample');

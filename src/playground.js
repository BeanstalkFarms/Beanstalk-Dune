const ethers = require('ethers');
const { providerThenable } = require('./provider.js');
const { BEANSTALK, BEAN, PEPE } = require('./addresses.js');
const { asyncBeanstalkContractGetter, getBalance } = require('./contracts/contracts.js');

async function logTestInfo() {
    // recent mints started: 18963933
    const harvestableNow = await asyncBeanstalkContractGetter().then(bc => bc.callStatic.harvestableIndex());
    const harvestableThen = await asyncBeanstalkContractGetter().then(bc => bc.callStatic.harvestableIndex({blockTag: 18963933}));
    const beanBalance = await getBalance(BEAN, BEANSTALK);
    const pepeBalance = await getBalance(PEPE, BEANSTALK);
    console.log(`Harvestable index: ${harvestableNow}\nOlder harvestable index: ${harvestableThen}\nBEAN: ${beanBalance}\nPEPE: ${pepeBalance}`);
}
// logTestInfo();
// uploadCsv('sample');

// Sample for getting data from beanstalk contract directly
async function contractData() {
    const provider = await providerThenable;
    const beanstalkStorage = (slot, blockNumber = 'latest') => {
        return provider.getStorageAt(BEANSTALK, slot, blockNumber);
    }
    const storedValue = await beanstalkStorage(3);
    const currentSeason = getStorageBytes(storedValue, 0, 4);
    console.log(currentSeason);
    const sunriseBlock = getStorageBytes(storedValue, 19, 4);
    console.log(sunriseBlock);
    const stemStartSeason = getStorageBytes(storedValue, 24, 2);
    console.log(stemStartSeason);
}

/**
 * Gets the value of the requested variable, accounting for packing
 * @param {string} data - The bytes data in an arbitrary storage slot
 * @param {number} start - The position of the data in its storage slot
 * @param {number} size - The size of the variable in bytes
 * @return {string} size bytes, or size*2 characters long
 */
function getStorageBytes(data, start, size) {
    const lower = 2 + (32 - start - size)*2;
    const upper = lower + size*2;
    return data.substring(lower, upper);
}

contractData();
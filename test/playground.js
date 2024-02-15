const ethers = require('ethers');
const { BigNumber } = require('alchemy-sdk');
const { providerThenable } = require('../src/provider.js');
const { BEANSTALK, BEAN, PEPE } = require('../src/addresses.js');
const { asyncBeanstalkContractGetter, getBalance } = require('../src/contracts/contracts.js');

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
    console.log('current season:', parseInt(currentSeason, 16));
    const sunriseBlock = getStorageBytes(storedValue, 19, 4);
    console.log('sunrise block:', parseInt(sunriseBlock, 16));
    const stemStartSeason = getStorageBytes(storedValue, 24, 2);
    console.log('stem start season:', parseInt(stemStartSeason, 16));

    const siloStalk = await beanstalkStorage("0x1b", 19130672);
    console.log('total silo stalk:', parseInt(siloStalk, 16));

    // Position 31 + 2 derived from storageLayout compiler output
    const currentTemp = getStorageBytes(await beanstalkStorage(31 + 2), 24, 4);
    console.log('temperature: ', parseInt(currentTemp, 16));

    const abiCoder = new ethers.AbiCoder();

    // Most recent sow as example
    // AppStorage -(49)> Account.State -(0)> Account.Field -(0)> plots
    {
        const address = '0x4Fea3B55ac16b67c279A042d10C0B7e81dE9c869'
        const index = '949411235551363';
        const encoded1 = abiCoder.encode(["address", "uint256"], [address, 49]);
        const keccak1 = ethers.keccak256(encoded1);
        const encoded2 = abiCoder.encode(["uint256", "uint256"], [index, keccak1]);
        const keccak2 = ethers.keccak256(encoded2);
        // console.log(encoded1, keccak1);
        // console.log(encoded2, keccak2);
        const podPlot = await beanstalkStorage(keccak2);
        console.log('pods?', parseInt(podPlot, 16));
    }

    // Top stalkholder as example
    // AppStorage -(49)> Account.State -(14)> roots
    {
        const address = '0xef49ffe2c1a6f64cfe18a26b3efe7d87830838c8';
        const encoded1 = abiCoder.encode(["address", "uint256"], [address, 49]);
        const keccak1 = ethers.keccak256(encoded1);
        const rootsSlot = BigNumber.from(keccak1).add(14);
        const roots = await beanstalkStorage(rootsSlot);
        console.log('roots?', parseInt(roots, 16));
    }
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

// contractData();

require('./contract-storage.js');
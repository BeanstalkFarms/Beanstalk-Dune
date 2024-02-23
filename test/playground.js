const ethers = require('ethers');
const { BigNumber } = require('alchemy-sdk');
const { providerThenable } = require('../src/provider.js');
const { BEANSTALK, BEAN, PEPE, UNRIPE_BEAN, UNRIPE_LP } = require('../src/addresses.js');
const { asyncBeanstalkContractGetter, getBalance } = require('../src/datasources/contract-function.js');
const { getStorageBytes } = require('../src/datasources/storage/utils/solidity-data.js');
const ContractStorage = require('../src/datasources/storage/contract-storage.js');
const storageLayout = require('../src/contracts/beanstalk/storageLayout.json');
const { assertNonzero, assertTrue } = require('./assert-simple.js');

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

// Sample for getting data from beanstalk contract directly (using manual calculation)
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

// contractData();

async function storageTest() {
    
    const beanstalk = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, 19235371);

    // Whole slot
    const seasonTimestamp = await beanstalk.s.season.timestamp;
    // Partial slot (no offset)
    const seasonNumber = await beanstalk.s.season.current;
    // Partial slot (with offset)
    const sunriseBlock = await beanstalk.s.season.sunriseBlock;
    console.log('season: ', seasonTimestamp, seasonNumber, sunriseBlock);

    // Mapping (recent sow as example)
    const sower = '0x4Fea3B55ac16b67c279A042d10C0B7e81dE9c869';
    const index = '949411235551363';
    const pods = await beanstalk.s.a[sower].field.plots[index];
    console.log('pods: ', pods);

    // Double mappings
    const unripeHolder = '0xbcc44956d70536bed17c146a4d9e66261bb701dd';
    const claimedURBean = await beanstalk.s.unripeClaimed[UNRIPE_BEAN][unripeHolder];
    const claimedURLP = await beanstalk.s.unripeClaimed[UNRIPE_LP][unripeHolder];
    console.log('claimedUnripe?', claimedURBean, claimedURLP);

    const internalBalanceHolder = '0xDE3E4d173f754704a763D39e1Dcf0a90c37ec7F0';
    const internalBeans = await beanstalk.s.internalTokenBalance[internalBalanceHolder][BEAN];
    console.log('internal balance:', internalBeans);

    const case1 = await beanstalk.s.cases[1]; // expect 0x01
    console.log('temp case 1:', case1);

    // Fixed - whole array (one slot)
    const allCases = await beanstalk.s.cases;
    console.log('all temp cases:', allCases);

    // Fixed - whole array (multiple slots)
    const deprecated = await beanstalk.s.deprecated;
    console.log('who knows whats in here (deprecated)', deprecated);
    const deprecated12 = await beanstalk.s.deprecated[12];
    console.log('deprecated[12]:', deprecated12);
    const deprecated12AsNumber = await beanstalk.s.deprecated[12].toNumber();
    console.log('deprecated[12]:', deprecated12AsNumber);

    assertNonzero({seasonTimestamp, seasonNumber, sunriseBlock, pods, internalBeans, case1, deprecated12, allCases1: allCases[1], deprecated12: deprecated[12], deprecated12AsNumber});
    assertTrue({claimedURBean});

    // Dyamic - one element
    const activeBips0 = await beanstalk.s.g.activeBips[0];
    console.log('activeBips[0]', activeBips0);

    // Dynamic - whole array
    const activeBipsAll = await beanstalk.s.g.activeBips;
    console.log('activeBipsAll', activeBipsAll);
}
storageTest();

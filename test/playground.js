const ethers = require('ethers');
const { BigNumber } = require('alchemy-sdk');
const { providerThenable } = require('../src/provider.js');
const { BEANSTALK, BEANSTALK_PRICE, BEAN, WETH, USDC, TETHER, DAI, PEPE, UNRIPE_BEAN, UNRIPE_LP, BEAN3CRV_V1, BEANLUSD, LUSD_3POOL, LUSD } = require('../src/addresses.js');
const { asyncBeanstalkContractGetter, asyncBean3CrvContractGetter, asyncBeanstalkPriceContractGetter, getBalance, asyncBean3CrvV1ContractGetter } = require('../src/datasources/contract-function.js');
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

    // Slot only
    console.log(beanstalk.s.season.timestamp.slot);
    console.log(beanstalk.s.unripeClaimed[UNRIPE_BEAN][unripeHolder].slot);
    console.log(beanstalk.s.deprecated[12].slot);

}
// storageTest();

(async () => {

    // Binary search to find first nonzero occurrence of this field
    // let bottom = 15277144;
    // let top = 15293274;
    // let middle = bottom + (top - bottom)/2;
    // while (true) {
    //     const beanstalk = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, middle);
    //     const activeFert = await beanstalk.s.activeFertilizer;
    //     console.log(middle, activeFert);
    //     if (activeFert.eq(BigNumber.from('0x00'))) {
    //         bottom = middle;
    //         middle = Math.round(middle + (top - middle)/2);
    //     } else {
    //         top = middle;
    //         middle = Math.round(middle - (middle - bottom)/2);
    //     }
    //     console.log(top, middle, bottom);
    //     if (top - bottom < 2) {
    //         break;
    //     }
    // }
    // const b1 = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, middle-1);
    // const b2 = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, middle);
    // const b3 = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, middle+1);
    // console.log(middle - 1, await b1.s.activeFertilizer, await b1.s.unfertilizedIndex);
    // console.log(middle, await b2.s.activeFertilizer, await b2.s.unfertilizedIndex);
    // console.log(middle + 1, await b3.s.activeFertilizer, await b3.s.unfertilizedIndex);

    // const usdcIn3Pool = await getBalance(TETHER, '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', 17687936);
    // console.log(usdcIn3Pool);

    // const balances = await asyncBean3CrvContractGetter().then(c => c.callStatic.get_balances());
    // console.log(balances[0].div(BigNumber.from(10).pow(6)));
    // console.log(balances[1].div(BigNumber.from(10).pow(18)));

    // console.log(balances[0].mul(BigNumber.from(10).pow(12)).toString());
    // console.log(balances[1].mul(Math.round(1.030992668095 * Math.pow(10, 12))).div(BigNumber.from(10).pow(12)).toString());
    
    // console.log(BigNumber.from('9396029925').mul(BigNumber.from(10).pow(12)).toString());
    // console.log(BigNumber.from('799334273630492').mul(Math.round(1.030992668095 * Math.pow(10, 12))).div(BigNumber.from(10).pow(12)).toString());
    // const vprice = await asyncBean3CrvContractGetter().then(c => c.callStatic.get_virtual_price());
    // console.log(vprice);

    // const curvePrice = await asyncBeanstalkPriceContractGetter().then(c => c.callStatic.getCurve());
    // console.log(curvePrice);

    // const stemTipUrbean = await asyncBeanstalkContractGetter().then(c => c.callStatic.stemTipForToken(UNRIPE_BEAN));
    // const stemTipUrlp = await asyncBeanstalkContractGetter().then(c => c.callStatic.stemTipForToken(UNRIPE_LP));
    // console.log(stemTipUrbean);
    // console.log(stemTipUrlp);

    const vprice = await asyncBean3CrvV1ContractGetter(BEAN3CRV_V1).then(c => c.callStatic.get_virtual_price({blockTag: 14266424}));
    const supply = await asyncBean3CrvV1ContractGetter(BEAN3CRV_V1).then(c => c.callStatic.totalSupply({blockTag: 14266424}));
    console.log(vprice.mul(supply).div(BigNumber.from(Math.pow(10,15))).div(BigNumber.from(Math.pow(10,15))));
    //1001057805629422154
    //3041196198395316937000000
    //3044413192854/2 - 1599413857097

    let lusdHolding = await asyncBean3CrvV1ContractGetter(LUSD).then(c => c.callStatic.balanceOf(BEANLUSD, {blockTag: 14450214}));
    console.log('l', lusdHolding.div(BigNumber.from('1000000000000000000')));

    const beanLusdPrice = await asyncBean3CrvV1ContractGetter(BEANLUSD).then(c => c.callStatic.get_dy(0, 1, 1000000, {blockTag: 14450214}));
    const lusdPrice = await asyncBean3CrvV1ContractGetter(LUSD_3POOL).then(c => c.callStatic.get_dy(0, 1, BigInt(1000000000000000000), {blockTag: 14450214}));
    console.log(beanLusdPrice);
    console.log(lusdPrice);//.div(BigNumber.from('1000000000000000000'))

})();

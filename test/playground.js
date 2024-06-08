const ethers = require('ethers');
const { BigNumber } = require('alchemy-sdk');
const { providerThenable } = require('../src/provider.js');
const { BEANSTALK, BEANSTALK_PRICE, BEAN, WETH, USDC, TETHER, DAI, PEPE, UNRIPE_BEAN, UNRIPE_LP, BEAN3CRV_V1, BEANLUSD, LUSD_3POOL, LUSD, BEANETH_UNIV2, WETHUSCD_UNIV2, BEANWETH, BEAN3CRV, THREEPOOL, CALCULATIONS_CURVE, CRV3 } = require('../src/addresses.js');
const { asyncBeanstalkContractGetter, asyncBean3CrvContractGetter, asyncBeanstalkPriceContractGetter, getBalance, asyncBean3CrvV1ContractGetter, getContractAsync, asyncUniswapV2ContractGetter, asyncWellContractGetter, asyncBasinPumpContractGetter } = require('../src/datasources/contract-function.js');
const { getStorageBytes } = require('../src/datasources/storage/utils/solidity-data.js');
const ContractStorage = require('../src/datasources/storage/contract-storage.js');
const storageLayout = require('../src/contracts/beanstalk/storageLayout.json');
const storageLayoutPreReplant = require('../src/contracts/beanstalk/storageLayout-PreReplant.json');
const { assertNonzero, assertTrue } = require('./assert-simple.js');
const { beanstalkSG, beanSG, beanTestSG, gql } = require('../src/datasources/subgraph/subgraph-query.js')
const { getAllPegCrossBlocks } = require('../src/external-use/peg-crosses.js')

const beanstalkInitAbi = require('../src/contracts/beanstalk/Beanstalk-Init.json');
const calculationsCurveAbi = require('../src/contracts/curve/CalculationsCurve.json');
const { identifyContracts } = require('../src/external-use/participant-contracts.js');
const { participantAddresses } = require('../src/external-use/data/participant-addresses.js');
const { binarySearch } = require('../src/utils/binary-search.js');

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

    // const vprice = await asyncBean3CrvV1ContractGetter(BEAN3CRV_V1).then(c => c.callStatic.get_virtual_price({blockTag: 14266424}));
    // const supply = await asyncBean3CrvV1ContractGetter(BEAN3CRV_V1).then(c => c.callStatic.totalSupply({blockTag: 14266424}));
    // console.log(vprice.mul(supply).div(BigNumber.from(Math.pow(10,15))).div(BigNumber.from(Math.pow(10,15))));
    // //1001057805629422154
    // //3041196198395316937000000
    // //3044413192854/2 - 1599413857097

    // let lusdHolding = await asyncBean3CrvV1ContractGetter(LUSD).then(c => c.callStatic.balanceOf(BEANLUSD, {blockTag: 14450214}));
    // console.log('l', lusdHolding.div(BigNumber.from('1000000000000000000')));

    // const beanLusdPrice = await asyncBean3CrvV1ContractGetter(BEANLUSD).then(c => c.callStatic.get_dy(0, 1, 1000000, {blockTag: 14450214}));
    // const lusdPrice = await asyncBean3CrvV1ContractGetter(LUSD_3POOL).then(c => c.callStatic.get_dy(0, 1, BigInt(1000000000000000000), {blockTag: 14450214}));
    // console.log(beanLusdPrice);
    // console.log(lusdPrice);//.div(BigNumber.from('1000000000000000000'))

    // const season67 = 12992176;
    // const season1795 = 13455814;
    // const beanstalkInit = await getContractAsync(BEANSTALK, beanstalkInitAbi);
    // twap = await beanstalkInit.callStatic.getTWAPPrices({ blockTag: season1795 });
    // twap = [BigNumber.from("245707004435700"), BigNumber.from("245207214122420")];
    // console.log(twap);
    // reserves = await beanstalkInit.callStatic.reserves({ blockTag: season67 });
    // console.log(reserves);

    // const reserves = await beanstalkInit.callStatic.reserves({blockTag: season1795});
    // console.log(reserves);

    // const mulReserves = reserves[0].mul(reserves[1]).mul(BigNumber.from("1000000"));
    // const currentBeans = mulReserves.div(twap[0]/*.mul(BigNumber.from("1000000000000000000"))*/);
    // const targetBeans = mulReserves.div(twap[1]/*.mul(BigNumber.from("1000000000000000000"))*/);
    // console.log(mulReserves);
    // console.log(sqrt(currentBeans), sqrt(targetBeans), sqrt(targetBeans).sub(sqrt(currentBeans)));
    // 735753474
    // 735753474

    // const beanethuniv2 = await asyncUniswapV2ContractGetter(BEANETH_UNIV2);
    // const reserves = await beanethuniv2.callStatic.getReserves({ blockTag: 13002683 })
    // const price0last = await beanethuniv2.callStatic.price0CumulativeLast({ blockTag: 13002684 })
    // const price1last = await beanethuniv2.callStatic.price1CumulativeLast({ blockTag: 13002684 })
    // console.log(reserves);
    // console.log(price0last);
    // console.log(price1last);

    // const wethusdcuniv2 = await asyncUniswapV2ContractGetter(WETHUSCD_UNIV2);
    // const price0last = await wethusdcuniv2.callStatic.price0CumulativeLast({ blockTag: 12992215 })
    // console.log(price0last);

    // const mulReserves = reserves[0].times(reserves[1]).times(BI_10.pow(6));
    // const currentBeans = mulReserves.div(prices.value0.times(BI_10.pow(18))).sqrt();
    // const targetBeans = mulReserves.div(prices.value1.times(BI_10.pow(18))).sqrt();
    // const deltaB = targetBeans.minus(currentBeans);

    // const blockStart = 14569458;
    // for (let i = 0; i < 2; i++) {
    //     const bean3crv1 = await asyncBean3CrvV1ContractGetter(BEAN3CRV_V1);
    //     const cumulativeLast = await bean3crv1.callStatic.get_price_cumulative_last({blockTag: blockStart + 100*i});
    //     const balances = await bean3crv1.callStatic.get_balances({blockTag: blockStart + 100*i});
    //     console.log(cumulativeLast);
    //     console.log(balances);
    //     console.log(await bean3crv1.callStatic.block_timestamp_last({blockTag: blockStart + 100*i}));
    //     cumulativeLast[0] = cumulativeLast[0].add(balances[0].mul(623));
    //     cumulativeLast[1] = cumulativeLast[1].add(balances[1].mul(623));
    //     console.log(cumulativeLast[0].add(balances[0].mul(623)), cumulativeLast[1].add(balances[1].mul(623)));
    //     console.log('------------------');
    // }

    // cumulativeBalances = IMeta3CurveOracle(C.CURVE_BEAN_METAPOOL).get_price_cumulative_last();
    // _twaBalances = IMeta3CurveOracle(C.CURVE_BEAN_METAPOOL).get_balances();
    // uint256 lastTimestamp = IMeta3CurveOracle(C.CURVE_BEAN_METAPOOL).block_timestamp_last();

    // const season2Storage = new ContractStorage(await providerThenable, BEANSTALK, storageLayoutPreReplant, 12974550);
    // console.log(await season2Storage.s.index);
    
    // const season67Storage = new ContractStorage(await providerThenable, BEANSTALK, storageLayoutPreReplant, 12992176);
    // console.log(await season67Storage.s.o.cumulative);
    // console.log(await season67Storage.s.o.pegCumulative);

    // const bean3crv1 = await asyncBean3CrvV1ContractGetter(BEAN3CRV);
    // const a = await bean3crv1.callStatic.A_precise();
    // const p = await bean3crv1.callStatic.get_price_cumulative_last({blockTag: 14450214});
    // const b = await bean3crv1.callStatic.get_balances({blockTag: 14450214});
    // const l = await bean3crv1.callStatic.block_timestamp_last({blockTag: 14450214});
    // console.log(a);
    // console.log(p);
    // console.log(b);
    // console.log(l);

    //17978135 not init
    //17978136 all zero
    //17978137 huge numbers

    // const beanethWell = await asyncWellContractGetter(BEANWETH);
    // const pump = await asyncBasinPumpContractGetter();
    // const reserves = await beanethWell.callStatic.getReserves({blockTag:"latest"});
    // const pumpReserves = await pump.callStatic.readCumulativeReserves(BEANWETH, "0x00", {blockTag:"latest"});
    // console.log(reserves);
    // console.log(pumpReserves);

    // 14441609 season 5471
    // 14441638 it switches to both be positive
    // 14441689 price drops but deltaBeans does not
    // const block = 14441689;
    // const bean3crv1 = await asyncBean3CrvV1ContractGetter(BEAN3CRV_V1);
    // const vprice = await bean3crv1.callStatic.get_virtual_price({blockTag: block});
    // const balances = await bean3crv1.callStatic.get_balances({blockTag: block});
    // const lpSupply = await bean3crv1.callStatic.totalSupply({blockTag: block});
    // console.log(vprice);
    // console.log(balances);
    // console.log(lpSupply);
    // console.log(vprice.mul(lpSupply).div(BigNumber.from("2000000000000000000000000000000")).sub(balances[0]));
    // const threepool = await asyncBean3CrvV1ContractGetter(THREEPOOL);
    // const threepool_vprice = await threepool.callStatic.get_virtual_price({blockTag: block});
    // console.log(threepool_vprice);

    // const calcCurve = await getContractAsync(CALCULATIONS_CURVE, calculationsCurveAbi);
    // const metapoolPrice = await calcCurve.getCurvePriceUsdc(CRV3, {blockTag: block});
    // const dy = await bean3crv1.get_dy(0, 1, 1000000, {blockTag: block});
    // console.log('mp', metapoolPrice);
    // console.log(metapoolPrice.mul(dy));

    // const bean3crv1 = await asyncBean3CrvV1ContractGetter(BEAN3CRV_V1);
    // const beanlusd = await asyncBean3CrvV1ContractGetter(BEANLUSD);
    // console.log(await bean3crv1.callStatic.fee());
    // console.log(await beanlusd.callStatic.fee());

    const bs = new ContractStorage(await providerThenable, BEANSTALK, storageLayout);
    // console.log(await bs.s.season.stemStartSeason);
    // console.log(await bs.s.a['0x10bf1dcb5ab7860bab1c3320163c6dddf8dcc0e4'].s.stalk.slot);
    // console.log(await bs.s.podOrders['0x255839c4aa83755d366d960fd3f4a478b0c3da3c5cceb04d62fb75f0228bf561']);
    // console.log(await asyncBeanstalkContractGetter().then(bc => bc.callStatic.balanceOfStalk('0x10bf1dcb5ab7860bab1c3320163c6dddf8dcc0e4')));
    // console.log(await bs.s.s.stalk);
    // console.log(await bs.s.a['0xc46C1B39E6c86115620f5297e98859529b92AD14'].s.stalk);
    // console.log(BEAN.toLowerCase(), await bs.s.siloBalances[BEAN].depositedBdv.toNumber(), await bs.s.siloBalances[BEAN].deposited);
    // console.log(BEAN3CRV.toLowerCase(), await bs.s.siloBalances[BEAN3CRV].depositedBdv.toNumber(), await bs.s.siloBalances[BEAN3CRV].deposited);
    // console.log(BEANWETH.toLowerCase(), await bs.s.siloBalances[BEANWETH].depositedBdv.toNumber(), await bs.s.siloBalances[BEANWETH].deposited);
    // console.log(UNRIPE_BEAN.toLowerCase(), await bs.s.siloBalances[UNRIPE_BEAN].depositedBdv.toNumber(), await bs.s.siloBalances[UNRIPE_BEAN].deposited);
    // console.log(UNRIPE_LP.toLowerCase(), await bs.s.siloBalances[UNRIPE_LP].depositedBdv.toNumber(), await bs.s.siloBalances[UNRIPE_LP].deposited);

    // const recapPaid = await asyncBeanstalkContractGetter().then(bc => bc.callStatic.getRecapPaidPercent());
    // console.log(recapPaid);

    // const price = await asyncBeanstalkPriceContractGetter().then(c => c.callStatic.price({blockTag:17978222}));
    // console.log(price.ps[1]);
    // const wellPrice = await asyncBeanstalkPriceContractGetter().then(c => c.callStatic.getConstantProductWell(BEANWETH,{blockTag:17978222}));
    // console.log(wellPrice);

    // let top = 19000000;
    // let bottom = 16000000;
    // let middle;
    // const u = () => middle = Math.floor((top + bottom) / 2);
    // u();
    // const beanstalk = await asyncBeanstalkContractGetter();
    // console.log(await beanstalk.callStatic.getTotalUnderlying("0x1bea3ccd22f4ebd3d37d731ba31eeca95713716d"));
    // while (middle < top && middle > bottom) {
    //     const underlying = await beanstalk.callStatic.getUnderlyingToken(UNRIPE_LP, {blockTag: middle});
    //     console.log(underlying, middle);
    //     if (underlying == BEAN3CRV) {
    //         bottom = middle;
    //     } else {
    //         top = middle;
    //     }
    //     u();
    // }
    // console.log(`${middle - 1} ${await beanstalk.callStatic.getUnderlyingToken(UNRIPE_LP, {blockTag: middle - 1})}`);
    // console.log(`${middle} ${await beanstalk.callStatic.getUnderlyingToken(UNRIPE_LP, {blockTag: middle})}`);
    // console.log(`${middle + 1} ${await beanstalk.callStatic.getUnderlyingToken(UNRIPE_LP, {blockTag: middle + 1})}`);
    
    // await beanEthPreReplant(13002683);
    // await beanEthPreReplant(13002684);
    // await beanEthPreReplant(13002685);
    // await beanEthPreReplant(13002008);
    // await beanEthPreReplant(13002009);
    // await beanEthPreReplant(13002010);
    // await beanEthPreReplant(14559084);
    // await beanEthPreReplant(14559085);
    // await beanEthPreReplant(14559086);

    // console.log(await beanstalk.callStatic.getRecapPaidPercent({blockTag: 15299963}));

    // console.log(await getAllPegCrossBlocks());
    // asyncBeanstalkContractGetter().then(b => b.callStatic.getTotalDeposited(BEANWETH)).then(console.log);
    // asyncBeanstalkContractGetter().then(b => b.callStatic.getTotalDeposited(UNRIPE_LP)).then(console.log);

    // Dune deposited Bean result 3,065,860
    // console.log(await bs.s.earnedBeans); // 1,398,408
    // console.log(await bs.s.siloBalances[BEAN].deposited); // 4,482,712
    
    // sg 3528278016452
    // ct 3526646564822
    // between 19928634 19929634

    // EBIP 19937474
    // sg 4356360513466
    // ct 4355696876590

    // const searchResult = await binarySearch(
    //     19000000,
    //     20034538,
    //     async (block) => {
    //         const sgResult = await beanstalkSG(gql`
    //             {
    //                 germinating(
    //                     block: {number: ${block}}
    //                     id: "0x047b22bfe547d29843c825dbcbd9e0168649d631-ODD"
    //                 ) {
    //                     id
    //                 }
    //             }`
    //         );
    //         // Looking for when it got created
    //         return sgResult.germinating === null ? 1 : -1;
    //     },
    //     console.log
    // );
    // console.log(`found at ${searchResult.location}`)

    ///// TODO: generalize this snippet as a generalized binary search on an arbitrary function
    // let top = 20000000;
    // let bottom = 19937474;
    // let middle;
    // const u = () => middle = Math.floor((top + bottom) / 2);
    // u();
    // while (middle < top && middle > bottom) {
    //     const search = await depsositedIncludingGerminating(middle);
    //     console.log(middle);
    //     if (search == 1) {
    //         bottom = middle;
    //     } else if (search == -1) {
    //         top = middle;
    //     }
    //     u();
    // }
    /////

    // const search = await depsositedIncludingGerminating(19941969);
    // asyncBeanstalkContractGetter().then(b => b.callStatic.stemTipForToken(BEAN, {blockTag: 19941969})).then(console.log);

    // console.log(await identifyContracts(participantAddresses));
    
})();

async function beanEthPreReplant(block) {
    const wethusdcuniv2 = await asyncUniswapV2ContractGetter("0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc");
    const beanethuniv2 = await asyncUniswapV2ContractGetter(BEANETH_UNIV2);
    const wethusdcReserves = await wethusdcuniv2.callStatic.getReserves({ blockTag: block });
    const wethPrice = wethusdcReserves[0].mul(BigNumber.from("1000000000000000000")).div(wethusdcReserves[1]);
    console.log('eth price', wethPrice.toNumber());

    const beanethReserves = await beanethuniv2.callStatic.getReserves({ blockTag: block });
    // let beanethReserves = [BigNumber.from("54089375322363179096"), BigNumber.from("166191599838")];
    let beanEthPrice = beanethReserves[0].mul(wethPrice).div(beanethReserves[1]).div(BigNumber.from("100000000"));
    console.log('bean price', beanEthPrice.toNumber());
    console.log('reserves', beanethReserves);

    // beanethReserves = [BigNumber.from("54839375322363179096"), BigNumber.from("163925438583")];
    // beanEthPrice = beanethReserves[0].mul(wethPrice).div(beanethReserves[1]).div(BigNumber.from("100000000"));
    // console.log('bean price', beanEthPrice.toNumber());
    // console.log('reserves', beanethReserves);

    // beanethReserves = [BigNumber.from("53997267788147734115"), BigNumber.from("166489609565")];
    // beanEthPrice = beanethReserves[0].mul(wethPrice).div(beanethReserves[1]).div(BigNumber.from("100000000"));
    // console.log('bean price', beanEthPrice.toNumber());
    // console.log('reserves', beanethReserves);
}

function sqrt(value) {
    if (value.lt(BigNumber.from("0"))) {
        throw new Error("Cannot compute square root of a negative number");
    }

    if (value.lt(BigNumber.from("2"))) {
        return value;
    }

    let z = value;
    let x = value.div(2).add(1); // Initial guess: (value / 2) + 1

    while (x.lt(z)) {
        z = x;
        x = value.div(x).add(x).div(2);
    }
    return z;
}
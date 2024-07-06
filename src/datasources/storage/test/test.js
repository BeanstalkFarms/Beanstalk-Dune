const { providerThenable } = require("../../../provider.js");
const { BEANSTALK, BEAN, UNRIPE_BEAN, UNRIPE_LP, BEANWETH } = require('../../../addresses.js');
const storageLayout = require('../samples/beanstalkStorageBIP47.json');
const ContractStorage = require("../src/contract-storage.js");

(async function storageTest() {
    
  const beanstalk = new ContractStorage(await providerThenable, BEANSTALK, storageLayout, 19235371);

  const unripeHolder = '0xbcc44956d70536bed17c146a4d9e66261bb701dd';

  const [
    seasonTimestamp,
    seasonNumber,
    sunriseBlock,
    pods,
    claimedURBean,
    claimedURLP,
    internalBeans,
    case1,
    allCases,
    deprecated,
    deprecated12
  ] = await Promise.all([
    // Whole slot
    beanstalk.s.season.timestamp,
    // Partial slot (no offset)
    beanstalk.s.season.current,
    // Partial slot (with offset)
    beanstalk.s.season.sunriseBlock,
    // Mapping (recent sow as example)
    beanstalk.s.a['0x4Fea3B55ac16b67c279A042d10C0B7e81dE9c869'].field.plots['949411235551363'],
    // Double mappings
    beanstalk.s.unripeClaimed[UNRIPE_BEAN][unripeHolder],
    beanstalk.s.unripeClaimed[UNRIPE_LP][unripeHolder],
    beanstalk.s.internalTokenBalance['0xDE3E4d173f754704a763D39e1Dcf0a90c37ec7F0'][BEAN],
    beanstalk.s.deprecated_cases[1], // expect 0x01
    // Fixed - whole array (one slot)
    beanstalk.s.deprecated_cases,
    // Fixed - whole array (multiple slots)
    beanstalk.s.deprecated,
    beanstalk.s.deprecated[12]

  ]);
  console.log('season: ', seasonTimestamp, seasonNumber, sunriseBlock);
  console.log('pods: ', pods);
  console.log('claimedUnripe?', claimedURBean, claimedURLP);
  console.log('internal balance:', internalBeans);
  console.log('temp case 1:', case1);
  console.log('all temp cases:', allCases);
  console.log('who knows whats in here (deprecated)', deprecated, beanstalk.s.deprecated.slot);
  console.log('deprecated[12]:', deprecated12);

  assertNonzero({seasonTimestamp, seasonNumber, sunriseBlock, pods, internalBeans, case1, deprecated12, allCases1: allCases[1], deprecated12: deprecated[12]});
  assertTrue({claimedURBean});

  const [
    activeBips0,
    activeBipsAll,
    podListing,
    selector,
    longBytes
  ] = await Promise.all([
    // Dyamic - one element
    beanstalk.s.g.activeBips[0],
    // Dynamic - whole array
    beanstalk.s.g.activeBips,
    // Bytes types
    beanstalk.s.podListings[725798462383772],
    beanstalk.s.ss[BEANWETH].gpSelector,
    beanstalk.s.wellOracleSnapshots[BEANWETH]
  ])
  console.log('activeBips[0]', activeBips0);
  console.log('activeBipsAll', activeBipsAll);
  console.log('podListing', podListing);
  console.log('gpSelector', selector);
  console.log('well snapshot', longBytes);

  // Slot only
  console.log(beanstalk.s.season.timestamp.slot);
  console.log(beanstalk.s.unripeClaimed[UNRIPE_BEAN][unripeHolder].slot);
  console.log(beanstalk.s.deprecated[12].slot);
  
  console.log(await beanstalk[19000000].s.s.stalk);
  console.log(await beanstalk[20000000].s.s.stalk);

})();

function assertNonzero(toCheck) {
  for (const property in toCheck) {
    if (typeof toCheck[property] === 'string') {
      // Hex string
      if (toCheck[property].replace('0','') === '') {
        console.log(`FAIL: ${property} was zero: ${toCheck[property]}`);
      }
    } else if (typeof toCheck[property] === 'object') {
      // BigNumber
      if (toCheck[property].isZero()) {
        console.log(`FAIL: ${property} was zero: ${toCheck[property].toHexString()}`);
      }
    }
  }
}

function assertTrue(toCheck) {
  for (const property in toCheck) {
    if (!toCheck[property]) {
      console.log(`FAIL: ${property} was not true: ${toCheck[property]}`);
    }
  }
}

const { providerThenable } = require("../../provider");
const { BEANSTALK, BEAN, UNRIPE_BEAN, UNRIPE_LP } = require('../../addresses.js');
const storageLayout = require('../../contracts/beanstalk/storageLayout.json');
const ContractStorage = require("./contract-storage");

(async function storageTest() {
    
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
  /// EDIT: no longer necessary now that using BigInt
  // const deprecated12AsNumber = await beanstalk.s.deprecated[12].toNumber();
  // console.log('deprecated[12]:', deprecated12AsNumber);

  assertNonzero({seasonTimestamp, seasonNumber, sunriseBlock, pods, internalBeans, case1, deprecated12, allCases1: allCases[1], deprecated12: deprecated[12]});
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

  console.log(await beanstalk.s.s.stalk);
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

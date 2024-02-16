const ethers = require('ethers');
const abiCoder = new ethers.AbiCoder();
const { BigNumber } = require('alchemy-sdk');
const { providerThenable } = require('../src/provider.js');
const { BEANSTALK, BEAN, UNRIPE_BEAN, UNRIPE_LP } = require('../src/addresses.js');
const { storage, types } = require('../src/contracts/beanstalk/storage.json');
const { assertNonzero, assertTrue } = require('./assert-simple.js');

// TODO: There may be a discrepancy with how I retrieve arrays, this will be trivial to fix as it becomes clear.
//  i.e. I know storage slots are lower order aligned, particularly for arrays of small elements,
//  but what happens when one such array overflows into multiple storage slots?

// The size of one storage slot, in bytes
const SLOT_SIZE = 32;

function transformMembersList(members) {
    const retval = {};
    for (const field of members) {
        retval[field.label] = field;
    }
    return retval;
}

function copy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Constructs a handler function to be used recursively with Proxy.
 * This allows accessing contract storage much like one would in solidity.
 * For example, we can write something like this to traverse multiple structs and mappings:
 * > await beanstalk.s.a[account].field.plots[index]
 */
async function makeHandler(contractAddress, blockNumber = 'latest') {
    const provider = await providerThenable;
    const handler = {
        get: function(target, property) {
            if (['storageSlot_jslib', 'currentType_jslib', 'then'].includes(property)) {
                return target[property];
            } else {
                // console.debug(`Current type: ${target.currentType_jslib}\nCurrent slot: ${target.storageSlot_jslib.toHexString()}\nSeeking property: ${property}`)
                let returnProxy;
                let slotOffset = 0;
                const currentType = types[target.currentType_jslib];
                if (currentType.hasOwnProperty('members')) {
                    // Struct
                    const members = transformMembersList(currentType.members);
                    const field = members[property];
                    returnProxy = new Proxy(copy(types[field.type]), handler);
                    returnProxy.storageSlot_jslib = target.storageSlot_jslib.add(parseInt(field.slot));
                    returnProxy.currentType_jslib = field.type;
                    slotOffset = field.offset;
                } else if (currentType.hasOwnProperty('value')) {
                    // Mapping
                    returnProxy = new Proxy(copy(types[currentType.value]), handler);
                    let keyType = currentType.key.slice(2); // remove the "t_"
                    keyType = keyType.includes('contract') ? 'address' : keyType;
                    const encoded = abiCoder.encode([keyType, 'uint256'], [property, target.storageSlot_jslib.toHexString()]);
                    const keccak = ethers.keccak256(encoded);
                    returnProxy.storageSlot_jslib = BigNumber.from(keccak);
                    returnProxy.currentType_jslib = currentType.value;
                    // console.debug('in mapping', keyType, property, target.storageSlot_jslib);
                } else if (currentType.label.includes('[]')) {
                    // Dynamic array (TODO)
                } else if (currentType.label.includes('[')) {
                    // Fixed array
                    const arrayBase = types[currentType.base];
                    const elementSize = arrayBase.numberOfBytes;
                    const bytePosition = elementSize * parseInt(property);
                    returnProxy = new Proxy(copy(arrayBase), handler);
                    returnProxy.storageSlot_jslib = target.storageSlot_jslib.add(Math.floor(bytePosition / SLOT_SIZE));
                    returnProxy.currentType_jslib = currentType.base;
                    slotOffset = bytePosition % SLOT_SIZE;
                }

                // console.log(currentType);
                // console.log(returnProxy.currentType_jslib);
                
                const returnType = types[returnProxy.currentType_jslib];
                if (returnType.label.includes('[')) {

                    const numberOfBytes = returnType.numberOfBytes;
                    const resultThenable = (data, arrayIndex, hasMoreSlots) => (resolve, reject) => {
                        // console.debug('Retrieving storage slot:', returnProxy.storageSlot_jslib.add(arrayIndex).toHexString());
                        provider.getStorageAt(contractAddress, returnProxy.storageSlot_jslib.add(arrayIndex), blockNumber)
                                .then(valueAtSlot => {
                                    // console.debug('slot:', valueAtSlot);
                                    const result = getStorageBytes(valueAtSlot, slotOffset, Math.min(SLOT_SIZE, numberOfBytes));
                                    if (!hasMoreSlots) {
                                        resolve(decodeArray(returnType.label, data + result));
                                    } else {
                                        resolve({then: resultThenable(data + result, arrayIndex + 1, numberOfBytes - SLOT_SIZE*(arrayIndex+1) > SLOT_SIZE)});
                                    }
                                });
                    };
                    const multipleSlots = numberOfBytes > SLOT_SIZE;
                    // Since at this point we are operating on an array, we can assume that "then" won't
                    // collide with a variable name (i.e. can't access property .then on an array in solidity)
                    returnProxy.then = resultThenable('0x', 0, multipleSlots);

                } else if (!(returnType.hasOwnProperty('members') || returnType.hasOwnProperty('value'))) {
                    // There are no further members, therefore this must be the end.

                    return new Promise((resolve, reject) => {
                        // console.debug('Retrieving storage slot:', returnProxy.storageSlot_jslib.toHexString());
                        provider.getStorageAt(contractAddress, returnProxy.storageSlot_jslib, blockNumber)
                                .then(valueAtSlot => {
                                    // console.debug('slot:', valueAtSlot);
                                    const result = getStorageBytes(valueAtSlot, slotOffset, returnType.numberOfBytes);
                                    if (returnType.label === 'bool') {
                                        resolve(result === '01');
                                    } else {
                                        resolve(result);
                                    }
                                });
                    });
                }
                return returnProxy;
            }
        }
    }
    return handler;
}

/**
 * Gets the value of the requested variable, accounting for packing
 * @param {string} data - The bytes data in an arbitrary storage slot
 * @param {number} start - The position of the data in its storage slot
 * @param {number} size - The size of the variable in bytes
 * @return {string} Hexadecimal representation of the result, using {size} bytes
 */
function getStorageBytes(data, start, size) {
    const lower = 2 + (SLOT_SIZE - start - size)*2;
    const upper = lower + size*2;
    return data.substring(lower, upper);
}

/**
 * Decode the array label into its 4 relevant components
 * @param {string} arrayLabel - of the form uint256[4], int8[2], bytes4[8], etc.
 */
function decodeArrayLabel(arrayLabel) {
    const regex = /(u)?(int|bytes)(\d+)\[(\d+)\]/;
    const match = regex.exec(arrayLabel);

    if (!match) {
        throw new Error('Unsupported data type found:', arrayLabel);
    }
    // TODO: need to consider structs and do the appropriate lookup to get dataSizeBits.
    return {
        isUnsigned: match[1] === 'u',
        dataType: match[2], // for now expecting "int" or "bytes"
        dataSizeBits: parseInt(match[3]),
        arraySize: parseInt(match[4])
    };
}

/**
 * AbiCoder cannot handle arrays of integers smaller than uint256, custom solution is required
 * @param {string} arrayType - of the form uint256[4], int8[2], bytes4[8], etc.
 * @param {string} data - all data corresponding to the array, potentially from multiple slots
 * @return {array<BigNumber>} ordered array of BigNumber corresponding to the contents
 */
function decodeArray(arrayType, data) {
    // console.debug('Decoding array:', arrayType, data);

    const { isUnsigned, dataType, dataSizeBits, arraySize } = decodeArrayLabel(arrayType);
    const dataSizeBytes = dataSizeBits / 4;

    const retval = [];
    for (let i = 0; i < arraySize; ++i) {
        const element = data.substring(data.length - (i+1)*dataSizeBytes, data.length - i*dataSizeBytes);
        if (dataType === 'int') {
            if (isUnsigned) {
                retval.push(BigNumber.from("0x" + element));
            } else {
                // TODO: put this logic in a more general place as its not solely relevant to arrays
                retval.push(BigNumber.from("0x" + element).fromTwos(dataSizeBits));
            }
        } else {
            retval.push(element);
        }
    }
    return retval;
}

async function storageTest() {
    
    const handler = await makeHandler(BEANSTALK, 19235371);
    // Transform all storage variables from an array into an object, such that labels are extracted as keys,
    // and the underlying object is using a custom proxy.
    const beanstalk = {};
    for (const field of storage) {
        beanstalk[field.label] = new Proxy(field, handler);
        beanstalk[field.label].storageSlot_jslib = BigNumber.from(0);
        beanstalk[field.label].currentType_jslib = field.type;
    }

    // Whole slot
    const seasonTimestamp = await beanstalk.s.season.timestamp;
    // Partial slot (no offset)
    const seasonNumber = await beanstalk.s.season.current;
    // Partial slot (with offset)
    const sunriseBlock = await beanstalk.s.season.sunriseBlock;
    // console.log('season: ', seasonTimestamp, seasonNumber, sunriseBlock);

    // Mapping (recent sow as example)
    const sower = '0x4Fea3B55ac16b67c279A042d10C0B7e81dE9c869';
    const index = '949411235551363';
    const pods = await beanstalk.s.a[sower].field.plots[index];
    // console.log('pods: ', pods);

    // Double mappings
    const unripeHolder = '0xbcc44956d70536bed17c146a4d9e66261bb701dd';
    const claimedURBean = await beanstalk.s.unripeClaimed[UNRIPE_BEAN][unripeHolder];
    const claimedURLP = await beanstalk.s.unripeClaimed[UNRIPE_LP][unripeHolder];
    // console.log('claimedUnripe?', claimedURBean, claimedURLP);

    const internalBalanceHolder = '0xDE3E4d173f754704a763D39e1Dcf0a90c37ec7F0';
    const internalBeans = await beanstalk.s.internalTokenBalance[internalBalanceHolder][BEAN];
    // console.log('internal balance:', internalBeans);

    const case1 = await beanstalk.s.cases[1]; // expect 0x01
    // console.log('temp case 1:', case1);

    // Array (one slot)
    const allCases = await beanstalk.s.cases;
    // console.log('all temp cases:', allCases);

    // Array (multiple slots)
    const deprecated = await beanstalk.s.deprecated;
    // console.log('who knows whats in here (deprecated)', deprecated);
    const deprecated12 = await beanstalk.s.deprecated[12];
    // console.log('deprecated[12]:', deprecated12);

    assertNonzero({seasonTimestamp, seasonNumber, sunriseBlock, pods, internalBeans, case1, deprecated12, allCases1: allCases[1], deprecated12: deprecated[12]});
    assertTrue({claimedURBean});

    // Dyamic size array

    // TODO: dynamic arrays

}
storageTest();

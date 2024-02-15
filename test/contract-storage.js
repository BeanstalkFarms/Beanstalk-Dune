const ethers = require('ethers');
const abiCoder = new ethers.AbiCoder();
const { BigNumber } = require('alchemy-sdk');
const { providerThenable } = require('../src/provider.js');
const { BEANSTALK, BEAN, UNRIPE_BEAN, UNRIPE_LP } = require('../src/addresses.js');
const { storage, types } = require('../src/contracts/beanstalk/storage.json');

function transformMembersList(members) {
    const retval = {};
    for (const field of members) {
        retval[field.label] = field;
    }
    return retval;
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
            if (['storageSlot_jslib', 'currentType_jslib'].includes(property)) {
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
                    returnProxy = new Proxy(types[field.type], handler);
                    returnProxy.storageSlot_jslib = target.storageSlot_jslib.add(parseInt(field.slot));
                    returnProxy.currentType_jslib = field.type;
                    slotOffset = field.offset;
                } else if (currentType.hasOwnProperty('value')) {
                    // Mapping
                    returnProxy = new Proxy(types[currentType.value], handler);
                    let keyType = currentType.key.slice(2); // remove the "t_"
                    keyType = keyType.includes('contract') ? 'address' : keyType;
                    const encoded = abiCoder.encode([keyType, 'uint256'], [property, target.storageSlot_jslib.toHexString()]);
                    const keccak = ethers.keccak256(encoded);
                    returnProxy.storageSlot_jslib = BigNumber.from(keccak);
                    returnProxy.currentType_jslib = currentType.value;
                    // console.debug('in mapping', keyType, property, target.storageSlot_jslib);
                }
                
                const returnType = types[returnProxy.currentType_jslib];
                if (!(returnType.hasOwnProperty('members') || returnType.hasOwnProperty('value'))) {
                    // There are no further members, therefore this must be the end.
                    // Return is a thenable object. This function itself cannot be async since it
                    // chains many calls together and needs to avoid its own .then in the proxy trap.
                    console.log('Retrieving storage slot:', returnProxy.storageSlot_jslib.toHexString());
                    // For arrays having multiple slots: there can be a performance improvement using
                    // Promise.all, but for now using a recursive solution, as this is simpler
                    // in handling dynamic arrays.
                    return provider.getStorageAt(contractAddress, returnProxy.storageSlot_jslib, blockNumber)
                            .then(valueAtSlot => {
                                const result = getStorageBytes(valueAtSlot, slotOffset, returnType.numberOfBytes);
                                if (returnType.label === 'bool') {
                                    return result === '0x01';
                                } else if (returnType.label.includes('[]')) {
                                    // Dynamic array - no size provided
                                } else if (returnType.label.includes('[')) {
                                    // Fixed array - size is provided
                                    return decodeArray(returnType.label, result);
                                }
                            });
                }
                return returnProxy;
            }
        },
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
    const lower = 2 + (32 - start - size)*2;
    const upper = lower + size*2;
    return '0x' + data.substring(lower, upper);
}

// AbiCoder cannot handle arrays of integers smaller than uint256, custom solution is required
function decodeArray(arrayType, data) {

    const regex = /(u)?(int|bytes)(\d+)\[(\d+)\]/;
    const match = regex.exec(arrayType);

    if (!match) {
        throw new Error('Unsupported data type found:', arrayType);
    }

    // Capturing groups
    const isUnsigned = match[1] === 'u';
    const dataType = match[2]; // for now expecting "int" or "bytes"
    const dataSizeBits = parseInt(match[3]);
    const arraySize = parseInt(match[4]);
    
    const dataSizeBytes = dataSizeBits / 4;
    const retval = [];
    for (let i = 0; i < arraySize; ++i) {
        const element = data.substring(data.length - (i+1)*dataSizeBytes, data.length - i*dataSizeBytes);
        if (dataType === 'int') {
            if (isUnsigned) {
                retval.push(parseInt(element, 16));
            } else {
                ;
                retval.push(BigNumber.from("0x" +element).fromTwos(dataSizeBits).toString());
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
    // const seasonTimestamp = await beanstalk.s.season.timestamp;
    // // Partial slot (no offset)
    // const seasonNumber = await beanstalk.s.season.current;
    // // Partial slot (with offset)
    // const sunriseBlock = await beanstalk.s.season.sunriseBlock;
    // console.log('season: ', seasonTimestamp, seasonNumber, sunriseBlock);

    // // Mapping (recent sow as example)
    // const sower = '0x4Fea3B55ac16b67c279A042d10C0B7e81dE9c869';
    // const index = '949411235551363';
    // const pods = await beanstalk.s.a[sower].field.plots[index];
    // console.log('pods: ', pods);

    // // Double mappings
    // const unripeHolder = '0xbcc44956d70536bed17c146a4d9e66261bb701dd';
    // const claimedURBean = await beanstalk.s.unripeClaimed[UNRIPE_BEAN][unripeHolder];
    // const claimedURLP = await beanstalk.s.unripeClaimed[UNRIPE_LP][unripeHolder];
    // console.log('claimedUnripe?', claimedURBean, claimedURLP);

    // const internalBalanceHolder = '0xDE3E4d173f754704a763D39e1Dcf0a90c37ec7F0';
    // const internalBeans = await beanstalk.s.internalTokenBalance[internalBalanceHolder][BEAN];
    // console.log('internal balance:', internalBeans);

    // Array (one slot)
    const tempCases = await beanstalk.s.cases;
    console.log('temperature cases:', tempCases);

    // Array (multiple slots)
    const deprecated = await beanstalk.s.deprecated;
    console.log('who knows whats in here (deprecated)', deprecated);

    // Dyamic size array

    // TODO: arrays - could require multiple slots, and parsing into the array
    // TODO: dynamic arrays

}
storageTest();

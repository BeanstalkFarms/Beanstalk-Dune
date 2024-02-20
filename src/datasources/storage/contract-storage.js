const ethers = require('ethers');
const abiCoder = new ethers.AbiCoder();
const { BigNumber } = require('alchemy-sdk');
const { SLOT_SIZE, getStorageBytes, decodeType, slotsForArrayIndex } = require('./utils/solidity-data.js');

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
function makeProxyHandler(provider, contractAddress, types, blockNumber = 'latest') {
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
                    const arraySlots = slotsForArrayIndex(parseInt(property), parseInt(arrayBase.numberOfBytes));
                    returnProxy = new Proxy(copy(arrayBase), handler);
                    returnProxy.storageSlot_jslib = target.storageSlot_jslib.add(arraySlots.slot);
                    returnProxy.currentType_jslib = currentType.base;
                    slotOffset = arraySlots.slotOffset;
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
                                        resolve(decodeType([...data, result], returnType, types));
                                    } else {
                                        // Recursion here
                                        resolve({then: resultThenable([...data, result], arrayIndex + 1, numberOfBytes - SLOT_SIZE*(arrayIndex+1) > SLOT_SIZE)});
                                    }
                                });
                    };
                    const multipleSlots = numberOfBytes > SLOT_SIZE;
                    // Since at this point we are operating on an array, we can assume that "then" won't
                    // collide with a variable name (i.e. can't access property .then on an array in solidity)
                    returnProxy.then = resultThenable([], 0, multipleSlots);

                } else if (!(returnType.hasOwnProperty('members') || returnType.hasOwnProperty('value'))) {
                    // There are no further members, therefore this must be the end.

                    const returnPromise = new Promise((resolve, reject) => {
                        // console.debug('Retrieving storage slot:', returnProxy.storageSlot_jslib.toHexString());
                        provider.getStorageAt(contractAddress, returnProxy.storageSlot_jslib, blockNumber)
                                .then(valueAtSlot => {
                                    // console.debug('slot:', valueAtSlot);
                                    const result = getStorageBytes(valueAtSlot, slotOffset, returnType.numberOfBytes);
                                    resolve(decodeType(result, returnType, types));
                                });
                    });
                    // Adds a toNumber function onto the return promise. This allows callers to choose whether
                    // to receive BigNumber or number in a single line without having to wrap the await.
                    // i.e. await beanstalk.s.deprecated[12].toNumber() vs (await beanstalk.s.deprecated[12]).toNumber()
                    returnPromise.toNumber = () => {return new Promise((resolve, reject) => returnPromise.then(bn => resolve(bn.toNumber())))};
                    return returnPromise;
                }
                return returnProxy;
            }
        }
    }
    return handler;
}

class ContractStorage {

    constructor(provider, contractAddress, storageLayout, blockNumber = 'latest') {

        const proxyHandler = makeProxyHandler(provider, contractAddress, storageLayout.types, blockNumber)
        // Initialize all top level storage fields
        for (const field of storageLayout.storage) {
            this[field.label] = new Proxy(field, proxyHandler);
            this[field.label].storageSlot_jslib = BigNumber.from(0);
            this[field.label].currentType_jslib = field.type;
        }
    }
}

module.exports = ContractStorage;

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
    const getStorageAt = (storageSlot) => provider.getStorageAt(contractAddress, storageSlot, blockNumber);
    const handler = {
        get: function(target, property) {
            if (['__storageSlot', '__currentType', 'then'].includes(property)) {
                return target[property];
            } else {
                // console.debug(`Current type: ${target.__currentType}\nCurrent slot: ${target.__storageSlot.toHexString()}\nSeeking property: ${property}`)
                let returnProxy;
                let slotOffset = 0;
                const currentType = types[target.__currentType];
                if (currentType.hasOwnProperty('members')) {
                    // Struct
                    const members = transformMembersList(currentType.members);
                    const field = members[property];
                    if (!field) {
                        throw new Error(`Unrecognized property \`${property}\` on \`${target.__currentType}\`. Please check the supplied storageLayout file.`);
                    }
                    returnProxy = new Proxy(copy(types[field.type]), handler);
                    returnProxy.__storageSlot = target.__storageSlot.add(parseInt(field.slot));
                    returnProxy.__currentType = field.type;
                    slotOffset = field.offset;
                } else if (currentType.hasOwnProperty('value')) {
                    // Mapping
                    returnProxy = new Proxy(copy(types[currentType.value]), handler);
                    let keyType = currentType.key.slice(2); // remove the "t_"
                    keyType = keyType.includes('contract') ? 'address' : keyType;
                    const encoded = abiCoder.encode([keyType, 'uint256'], [property, target.__storageSlot.toHexString()]);
                    const keccak = ethers.keccak256(encoded);
                    returnProxy.__storageSlot = BigNumber.from(keccak);
                    returnProxy.__currentType = currentType.value;
                } else if (currentType.encoding === 'dynamic_array') {
                    // Dynamic array
                    returnProxy = new Proxy(copy(types[currentType.base]), handler);
                    const encoded = abiCoder.encode(['uint256'], [target.__storageSlot.toHexString()]);
                    const keccak = ethers.keccak256(encoded);
                    returnProxy.__storageSlot = BigNumber.from(keccak).add(property);
                    returnProxy.__currentType = currentType.base;
                } else if (currentType.label.includes('[')) {
                    // Fixed array
                    const arrayBase = types[currentType.base];
                    const arraySlots = slotsForArrayIndex(parseInt(property), parseInt(arrayBase.numberOfBytes));
                    returnProxy = new Proxy(copy(arrayBase), handler);
                    returnProxy.__storageSlot = target.__storageSlot.add(arraySlots.slot);
                    returnProxy.__currentType = currentType.base;
                    slotOffset = arraySlots.slotOffset;
                }
                
                const returnType = types[returnProxy.__currentType];
                if (returnType.label.includes('[')) {
                    // For array types, also attach a then method to the return proxy so the caller
                    // has an option to get the whole array and iterate it.
                    // Currently this only would be effective for flat arrays containing primitive types.

                    // Starting point of the array in storage, will retrieve sequentially after this
                    let arrayStart = -1;
                    // Number of bytes to retrieve. Used in determining if more storage should be retrieved.
                    let numberOfBytes = -1;
                    const bytesPerElement = types[returnType.base].numberOfBytes;
                    // Max number of bytes that could be used by one array slot. For example, if its an array
                    // of structs which are 10 bytes each, maxUsedBytesPerSlot = 30.
                    const maxUsedBytesPerSlot = Math.floor(SLOT_SIZE / bytesPerElement) * bytesPerElement;
                    if (returnType.encoding === 'dynamic_array') {
                        // The array begins at keccak(slot)
                        const encodedSlot = abiCoder.encode(['uint256'], [returnProxy.__storageSlot.toHexString()]);
                        const keccak = ethers.keccak256(encodedSlot);
                        arrayStart = BigNumber.from(keccak);
                        // numberOfBytes will be calculated on first call to makeResultThenable.
                    } else {
                        arrayStart = returnProxy.__storageSlot;
                        numberOfBytes = returnType.numberOfBytes;
                    }
                    const makeResultThenable = (data, arrayIndex) => (resolve, reject) => {
                        const getStorage = () => getStorageAt(arrayStart.add(arrayIndex))
                                .then(valueAtSlot => {
                                    const remainingBytes = numberOfBytes - SLOT_SIZE*(arrayIndex);
                                    // Parse only the bytes which are relevant to the contents of the result array
                                    const result = getStorageBytes(valueAtSlot, slotOffset, Math.min(maxUsedBytesPerSlot, remainingBytes));
                                    if (remainingBytes > SLOT_SIZE) {
                                        // Recursion here
                                        resolve({then: makeResultThenable([...data, result], arrayIndex + 1)});
                                    } else {
                                        resolve(decodeType([...data, result], returnType, types));
                                    }
                                });
                        if (numberOfBytes === -1) {
                            getStorageAt(returnProxy.__storageSlot)
                                    .then(arraySize => {
                                        const elementsPerSlot = Math.floor(SLOT_SIZE / bytesPerElement);
                                        const totalSlots = Math.ceil(1 / elementsPerSlot * arraySize);
                                        const elementsInFinalSlot = arraySize % elementsPerSlot;
                                        numberOfBytes = (totalSlots - 1) * SLOT_SIZE + elementsInFinalSlot * bytesPerElement;
                                    })
                                    .then(getStorage);
                        } else {
                            getStorage();
                        }
                    };
                    // Since at this point we are operating on an array, we can assume that "then" won't
                    // collide with a variable name (i.e. can't access property .then on an array in solidity)
                    returnProxy.then = makeResultThenable([], 0);

                } else if (!(returnType.hasOwnProperty('members') || returnType.hasOwnProperty('value'))) {
                    // There are no further members, therefore this must be the end.

                    const returnThenable = (resolve, reject) => {
                        // console.debug('Retrieving storage slot:', returnProxy.__storageSlot.toHexString());
                        getStorageAt(returnProxy.__storageSlot)
                                .then(valueAtSlot => {
                                    // console.debug('slot:', valueAtSlot);
                                    const result = getStorageBytes(valueAtSlot, slotOffset, returnType.numberOfBytes);
                                    resolve(decodeType(result, returnType, types));
                                });
                    };
                    
                    // Generic thenable is preferable to Promise as sometimes the caller only wants the slot number,
                    // and in such cases there is no need to preload the result.
                    return {
                        slot: returnProxy.__storageSlot,
                        then: returnThenable,
                        // Adds a toNumber function onto the return thenable. This allows callers to choose whether
                        // to receive BigNumber or number in a single line without having to wrap the await.
                        // i.e. await beanstalk.s.deprecated[12].toNumber() vs (await beanstalk.s.deprecated[12]).toNumber()
                        toNumber: () => {
                            // Compare with promise syntax
                            // {return new Promise((resolve, reject) => returnThenable.then(bn => resolve(bn.toNumber())))};
                            return { then: (resolve, reject) => returnThenable((bn) => resolve(bn.toNumber())) }
                        }
                    }
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
            this[field.label].__storageSlot = BigNumber.from(0);
            this[field.label].__currentType = field.type;
        }
    }
}

module.exports = ContractStorage;

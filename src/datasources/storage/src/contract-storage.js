const ethers = require('ethers');
const abiCoder = new ethers.AbiCoder();
const { SLOT_SIZE, getStorageBytes, decodeType, slotsForArrayIndex } = require('./utils/solidity-data.js');
const retryable = require('./utils/retryable.js');

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
function makeProxyHandler(provider, contractAddress, types, blockNumber = 'latest') {
  const getStorageAt = (storageSlot) => retryable(() => provider.getStorageAt(contractAddress, storageSlot, blockNumber));
  const handler = {
    get: function(target, property) {
      if (Object.keys(target).includes(property)) {
        // Passthrough for explicitly defined fields
        return target[property];
      } else {
        // console.debug(`Current type: ${target.__currentType}\nCurrent slot: ${target.__storageSlot.toString(16)}\nSeeking property: ${property}`)
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
          returnProxy = new Proxy({}, handler);
          returnProxy.__storageSlot = target.__storageSlot + BigInt(parseInt(field.slot));
          returnProxy.__currentType = field.type;
          slotOffset = field.offset;
        } else if (currentType.hasOwnProperty('value')) {
          // Mapping
          returnProxy = new Proxy({}, handler);
          let keyType = currentType.key.slice(2); // remove the "t_"
          keyType = keyType.includes('contract') ? 'address' : keyType.includes('enum') ? 'uint8' : keyType;
          const encoded = abiCoder.encode([keyType, 'uint256'], [property, "0x" + target.__storageSlot.toString(16)]);
          const keccak = ethers.keccak256(encoded);
          returnProxy.__storageSlot = BigInt(keccak);
          returnProxy.__currentType = currentType.value;
        } else if (currentType.encoding === 'dynamic_array') {
          // Dynamic array
          returnProxy = new Proxy({}, handler);
          const encoded = abiCoder.encode(['uint256'], ["0x" + target.__storageSlot.toString(16)]);
          const keccak = ethers.keccak256(encoded);
          returnProxy.__storageSlot = BigInt(keccak) + BigInt(property);
          returnProxy.__currentType = currentType.base;
        } else if (currentType.label.includes('[')) {
          // Fixed array
          const arrayBase = types[currentType.base];
          const arraySlots = slotsForArrayIndex(parseInt(property), parseInt(arrayBase.numberOfBytes));
          returnProxy = new Proxy({}, handler);
          returnProxy.__storageSlot = target.__storageSlot + BigInt(arraySlots.slot);
          returnProxy.__currentType = currentType.base;
          slotOffset = arraySlots.slotOffset;
        }
        
        const returnType = types[returnProxy.__currentType];
        const isArray = returnType.label.includes('[');
        const isVariableBytes = returnType.encoding === 'bytes';
        if (isArray || isVariableBytes) {
          // For array types, also attach a then method to the return proxy so the caller
          // has an option to get the whole array and iterate it.
          // Currently this only would be effective for flat arrays containing primitive types.

          // Starting point of the array in storage, will retrieve sequentially after this
          let arrayStart = -1;
          // Number of bytes to retrieve. Used in determining if more storage should be retrieved.
          let numberOfBytes = -1;
          const bytesPerElement = isArray ? types[returnType.base].numberOfBytes : 32;
          // Max number of bytes that could be used by one array slot. For example, if its an array
          // of structs which are 10 bytes each, maxUsedBytesPerSlot = 30.
          const maxUsedBytesPerSlot = Math.floor(SLOT_SIZE / bytesPerElement) * bytesPerElement;
          if (returnType.encoding === 'dynamic_array' || isVariableBytes) {
            // The array begins at keccak(slot)
            const encodedSlot = abiCoder.encode(['uint256'], ["0x" + returnProxy.__storageSlot.toString(16)]);
            const keccak = ethers.keccak256(encodedSlot);
            arrayStart = BigInt(keccak);
            // numberOfBytes will be calculated on first call to makeResultThenable.
          } else {
            arrayStart = returnProxy.__storageSlot;
            numberOfBytes = returnType.numberOfBytes;
          }
          const makeResultThenable = (data, arrayIndex) => (resolve, reject) => {
              const getStorage = () => getStorageAt(arrayStart + BigInt(arrayIndex))
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
                if (isArray) {
                  // Array: The regular storage slot contains the length of the array
                  getStorageAt(returnProxy.__storageSlot)
                    .then(arraySize => {
                      const elementsPerSlot = Math.floor(SLOT_SIZE / bytesPerElement);
                      const totalSlots = Math.ceil(1 / elementsPerSlot * arraySize);
                      const elementsInFinalSlot = arraySize % elementsPerSlot;
                      numberOfBytes = (totalSlots - 1) * SLOT_SIZE + elementsInFinalSlot * bytesPerElement;
                    })
                    .then(getStorage);
                } else if (isVariableBytes) {
                  // Bytes: the regular storage slot contains nothing and is keccak'd to get an offset value.
                  // That offset value is used to point to the length of the bytes (number of slots used)
                  getStorageAt(arrayStart)
                    .then(async slotVal => {
                      const startOffset = BigInt(slotVal);
                      const numSlots = await getStorageAt(arrayStart + startOffset / 32n);
                      arrayStart += startOffset / 32n + 1n;
                      numberOfBytes = numSlots * SLOT_SIZE;
                    })
                    .then(getStorage);
                }
              } else {
                getStorage();
              }
          };
          // Since at this point we are operating on an array, we can assume that "then" won't
          // collide with a variable name (i.e. can't access property .then on an array in solidity)
          returnProxy.then = makeResultThenable([], 0);
          returnProxy.slot = returnProxy.__storageSlot;

        } else if (!(returnType.hasOwnProperty('members') || returnType.hasOwnProperty('value'))) {
          // There are no further members, therefore this must be the end.

          const returnThenable = (resolve, reject) => {
            // console.debug('Retrieving storage slot:', returnProxy.__storageSlot.toString(16));
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
            /// EDIT: this is no longer necessary now that BigInt is used instead
            // Adds a toNumber function onto the return thenable. This allows callers to choose whether
            // to receive BigNumber or number in a single line without having to wrap the await.
            // i.e. await beanstalk.s.deprecated[12].toNumber() vs (await beanstalk.s.deprecated[12]).toNumber()
            // toNumber: () => {
            //     // Compare with promise syntax
            //     // {return new Promise((resolve, reject) => returnThenable.then(bn => resolve(bn.toNumber())))};
            //     return { then: (resolve, reject) => returnThenable((bn) => resolve(bn.toNumber())) }
            // }
          }
        }
        return returnProxy;
      }
    }
  }
  return handler;
}

// See README.md for detailed instructions
class ContractStorage {

  /**
   * @param provider - an ethersjs provider, or anything having a `.getStorageAt(address, slot)` function.
   * @param contractAddress - the address of the contract that you desire to retrieve storage for
   * @param storageLayout - the storage layout mapping for your contract.
   * @param defaultBlock - the default block number to use for storage lookup.
   * @returns
   */
  constructor(provider, contractAddress, storageLayout, defaultBlock = 'latest') {
  
    this.__storageLayout = storageLayout;
    this.__defaultBlock = defaultBlock;

    // Create top level proxy with recreatable subproxies, necessary for isolated state
    const initProxyHandler = {
      get: (target, property) => {
        if (['__setDefaultBlock'].includes(property)) {
          return target[property];
        }

        if (!target.__block) {
          // A block has not been selected yet
          const isLeadingNumeric = property.charCodeAt(0) >= 48 && property.charCodeAt(0) <= 57;
          if (isLeadingNumeric) {
            // Need to receive an additional property
            return new Proxy({ __block: parseInt(property) }, initProxyHandler);
          }
        }

        const block = target.__block ?? this.__defaultBlock;
        // Initialize all top level storage fields
        const fieldProxyHandler = makeProxyHandler(provider, contractAddress, this.__storageLayout.types, block);
        const requestedField = storageLayout.storage.filter(f => f.label === property);
        if (requestedField.length !== 1) {
          throw new Error(`Unrecognized top-level property \`${property}\`. Please check the supplied storageLayout file.`);
        }

        const returnProxy = new Proxy({}, fieldProxyHandler);
        returnProxy.__storageSlot = BigInt(0);
        returnProxy.__currentType = requestedField[0].type;
        return returnProxy;
      }
    };
    return new Proxy(this, initProxyHandler);
  }

  __setDefaultBlock(newDefault) {
    this.__defaultBlock = newDefault;
  }
}

module.exports = ContractStorage;

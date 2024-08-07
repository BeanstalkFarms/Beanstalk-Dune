// The size of one storage slot, in bytes
const SLOT_SIZE = 32;

/**
 * Gets the value of the requested variable, accounting for packing
 * @param {string} data - The bytes data in an arbitrary storage slot. If the length of this data
 *   is fewer than SLOT_SIZE bytes, it is assumed to be lower order within its respective slot.
 * @param {number} start - The position of the data in its storage slot
 * @param {number} size - The size of the variable in bytes
 * @return {string} Hexadecimal representation of the result, using {size} bytes
 */
function getStorageBytes(data, start, size) {
  const dataOnly = data.startsWith('0x') ? data.slice(2) : data;
  const lower = (dataOnly.length/2 - start - size)*2;
  const upper = lower + size*2;
  return dataOnly.substring(lower, upper);
}

/**
 * Decode the type label into its 4 relevant components
 * @param {string} type - of the form int8, uint256, uint256[4], bytes4[8] int8[2], etc.
 * @param {object} typesMapping - the types mapping from storageLayout file
 */
function decodeTypeLabel(type, typesMapping) {
  const regex = /(u)?(int|bytes)(\d+)(?:\[(\d+)\])?/;
  const match = regex.exec(type.label);

  if (!match) {
    throw new Error('Unsupported data type found:' + type.label);
  }

  // For arrays, get dataSizeBits from mapping instead, as this works with types other than int types (i.e. struct etc)
  const dataSizeBits = type.base === undefined ? parseInt(match[3]) : parseInt(typesMapping[type.base].numberOfBytes) * 8;
  return {
    isUnsigned: match[1] === 'u',
    dataType: match[2], // for now expecting "int" or "bytes"
    dataSizeBits: dataSizeBits,
    arraySize: parseInt(match[4])
  };
}

/**
 * AbiCoder cannot handle arrays of integers smaller than uint256, custom solution is required
 * @param {string} arrayType - entry in the types mapping for this array
 * @param {string} dataSlots - array of data contained in potentially multiple contiguous storage slots
 * @param {object} typesMapping - the types mapping from storageLayout file
 * @return {array<BigInt>} ordered array of BigInt corresponding to the contents
 */
function decodeArray(arrayType, dataSlots, typesMapping) {

  const { dataSizeBits } = decodeTypeLabel(arrayType, typesMapping);
  const dataSizeBytes = dataSizeBits / 8;

  const retval = [];
  for (const data of dataSlots) {
    for (let offset = 0; offset < data.length / 2; offset += dataSizeBytes) {
      const entry = getStorageBytes(data, offset, dataSizeBytes);
      retval.push(decodeType(entry, typesMapping[arrayType.base], typesMapping));
    }
  }
  return retval;
}

function dataToBN(data, isUnsigned, dataSizeBits) {
  if (isUnsigned) {
    return BigInt("0x" + data);
  } else {
    return fromTwosComplement("0x" + data, dataSizeBits);
  }
}

function decodeType(data, type, typesMapping) {

  if (type.label.includes('[')) {
    // Assumption is that dynamic vs static size arrays would be decoded in the same fashion
    return decodeArray(type, data, typesMapping);
  } else if (type.label === 'bool') {
    return data === '01';
  } else if (type.label === 'address' || type.label.startsWith('bytes') || type.label.startsWith('contract')) {
    if (Array.isArray(data)) {
      return '0x' + data.join('');
    } else {
      return '0x' + data;
    }
  } else if (type.label.includes('int') || type.label.startsWith('enum')) {
    const { isUnsigned, dataSizeBits } = decodeTypeLabel(type, typesMapping);
    return dataToBN(data, isUnsigned, dataSizeBits);
  }
  return data;
}

/**
 * For the requested array index, determine where in storage is the corresponding element.
 * This is particularly relevant for base elements such as structs or addresses which cannot evenly fill slots.
 * @param {number} arrayIndex - the index being accessed in the array
 * @param {number} baseElementSize - size in bytes of the array's base element
 * @return {object} returns the slot and slotOffset to be applied
 */
function slotsForArrayIndex(arrayIndex, baseElementSize) {
  const elementsPerSlot = Math.floor(SLOT_SIZE / baseElementSize);
  return { slot: Math.floor(arrayIndex / elementsPerSlot), slotOffset: (arrayIndex % elementsPerSlot) * baseElementSize };
}

function fromTwosComplement(hexString, bitSize) {
  const data = BigInt(hexString);
  const mask = BigInt(1) << BigInt(bitSize - 1);
  const max = (BigInt(1) << BigInt(bitSize)) - BigInt(1);
  
  if (data & mask) {
    // If the number is negative
    return data - (max + BigInt(1));
  } else {
    // If the number is positive
    return data;
  }
}

module.exports = {
  SLOT_SIZE,
  getStorageBytes,
  decodeType,
  slotsForArrayIndex
};

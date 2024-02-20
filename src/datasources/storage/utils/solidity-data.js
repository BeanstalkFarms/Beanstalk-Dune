const { BigNumber } = require('alchemy-sdk');

// The size of one storage slot, in bytes
const SLOT_SIZE = 32;

/**
 * Gets the value of the requested variable, accounting for packing
 * @param {string} data - The bytes data in an arbitrary storage slot
 * @param {number} start - The position of the data in its storage slot
 * @param {number} size - The size of the variable in bytes
 * @return {string} Hexadecimal representation of the result, using {size} bytes
 */
function getStorageBytes(data, start, size) {
    const lower = (data.startsWith('0x') ? 2 : 0) + (SLOT_SIZE - start - size)*2;
    const upper = lower + size*2;
    return data.substring(lower, upper);
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
 * @param {string} dataSlots - list of data contained in potentially multiple contiguous storage slots
 * @param {object} typesMapping - the types mapping from storageLayout file
 * @return {array<BigNumber>} ordered array of BigNumber corresponding to the contents
 */
function decodeArray(arrayType, dataSlots, typesMapping) {
    // console.debug('Decoding array:', arrayType, data);

    const { dataSizeBits, arraySize } = decodeTypeLabel(arrayType, typesMapping);
    const dataSizeBytes = dataSizeBits / 8;

    const retval = [];
    for (const slot of dataSlots) {
        for (let offset = 0; offset < SLOT_SIZE; offset += dataSizeBytes) {
            const entry = getStorageBytes(slot, offset, dataSizeBytes);
            retval.push(decodeType(entry, typesMapping[arrayType.base], typesMapping));
        }
    }
    return retval;
}

function dataToBN(data, isUnsigned, dataSizeBits) {
    if (isUnsigned) {
        return BigNumber.from("0x" + data);
    } else {
        return BigNumber.from("0x" + data).fromTwos(dataSizeBits);
    }
}

function decodeType(data, type, typesMapping) {

    if (type.label.includes('[')) {
        // Assumption is that dynamic vs static size arrays would be decoded in the same fashion
        return decodeArray(type, data, typesMapping);
    } else if (type.label === 'bool') {
        return data === '01';
    } else if (type.label === 'address' || type.label.startsWith('contract')) {
        return '0x' + data;
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

module.exports = {
    SLOT_SIZE,
    getStorageBytes,
    decodeType,
    slotsForArrayIndex
};

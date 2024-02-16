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

module.exports = {
    SLOT_SIZE,
    getStorageBytes,
    decodeArrayLabel,
    decodeArray
};

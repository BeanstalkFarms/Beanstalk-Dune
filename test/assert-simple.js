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

module.exports = {
    assertNonzero,
    assertTrue
};

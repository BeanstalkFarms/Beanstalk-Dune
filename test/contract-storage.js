const ethers = require('ethers');
const abiCoder = new ethers.AbiCoder();
const { BigNumber } = require('alchemy-sdk');
const { storage, types } = require('../src/contracts/beanstalk/storage.json');

function transformMembersList(members) {
    const retval = {};
    for (const field of members) {
        retval[field.label] = field;
    }
    return retval;
}

const handler = {
    get: function(target, property) {
        if (['storageSlot_jslib', 'slotOffset_jslib', 'currentType_jslib'].includes(property)) {
            return target[property];
        } else {
            // console.debug(target);
            console.debug('Current type:', target.currentType_jslib, '| Seeking property:', property);
            let returnProxy;
            const currentType = types[target.currentType_jslib];
            if (currentType.hasOwnProperty('members')) {
                // Struct
                const members = transformMembersList(currentType.members);
                const field = members[property];
                returnProxy = new Proxy(types[field.type], handler);
                returnProxy.storageSlot_jslib = target.storageSlot_jslib.add(parseInt(field.slot));
                returnProxy.slotOffset_jslib = field.offset;
                returnProxy.currentType_jslib = field.type;
            } else if (currentType.hasOwnProperty('value')) {
                // Mapping
                returnProxy = new Proxy(types[currentType.value], handler);
                const keyType = currentType.key.slice(2); // remove the "t_"
                console.debug('in mapping', keyType, property, target.storageSlot_jslib);
                const encoded = abiCoder.encode([keyType, "uint256"], [property, target.storageSlot_jslib.toHexString()]);
                const keccak = ethers.keccak256(encoded);
                returnProxy.storageSlot_jslib = BigNumber.from(keccak);
                returnProxy.slotOffset_jslib = 0;
                returnProxy.currentType_jslib = currentType.value;
            }

            // console.log(currentType);
            
            const returnType = types[returnProxy.currentType_jslib];
            if (!(returnType.hasOwnProperty('members') || returnType.hasOwnProperty('value'))) {
                // There are no further members, therefore this must be the end.
                // use numberOfBytes
                return [returnProxy.storageSlot_jslib, returnProxy.slotOffset_jslib];
            }
            return returnProxy;
        }
    },
};

// Transform all storage variables from an array into an object, such that labels are extracted as keys,
// and the underlying object is using a custom proxy.
const beanstalk = {};
for (const field of storage) {
    beanstalk[field.label] = new Proxy(field, handler);
    beanstalk[field.label].storageSlot_jslib = BigNumber.from(0);
    beanstalk[field.label].slotOffset_jslib = 0;
    // TODO: need numberOfBytes also?
    beanstalk[field.label].currentType_jslib = field.type;
}

// Whole slot
const seasonTimestamp = beanstalk.s.season.timestamp;
// Partial slot (no offset)
const seasonNumber = beanstalk.s.season.current;
// Partial slot (with offset)
const withdrawSeasons = beanstalk.s.season.withdrawSeasons;
console.log('season: ', seasonTimestamp, seasonNumber, withdrawSeasons);

// Mapping (recent sow as example)
const account = '0x4Fea3B55ac16b67c279A042d10C0B7e81dE9c869';
const index = '949411235551363';
const pods = beanstalk.s.a[account].field.plots[index];
console.log('pods: ', pods);


// For structs: will have "members" field.
// For mappings: will have "value" field for the type that the mapping points to.

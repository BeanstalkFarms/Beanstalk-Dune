const { providerThenable } = require("../provider");
const fs = require('fs');

// An address is considered to be a contract if it has associated code
async function isContract(address) {
  const provider = await providerThenable;
  try {
    return await provider.getCode(address) !== "0x";
  } catch (e) {
    return false;
  }
}

// Identifies which of the provided addresses are contracts
async function identifyContracts(addresses) {

  const results = await Promise.all(addresses.map(async address => ({
    address,
    isContract: await isContract(address)
  })));
  const filtered = results.filter(r => r.isContract);

  await fs.promises.appendFile('results/participant-contracts.txt', filtered.map(r => r.address).join('\n'));

  return filtered;
}

module.exports = {
  isContract,
  identifyContracts
}

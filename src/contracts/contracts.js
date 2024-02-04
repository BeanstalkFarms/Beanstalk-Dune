const { alchemy } = require('../provider.js');
const { Contract, BigNumber } = require('alchemy-sdk');
const { BEANSTALK, DECIMALS } = require('../addresses.js');
const beanAbi = require('./beanstalk.json');
const erc20Abi = require('./erc20.json');

const contracts = {};
async function getContractAsync(address, abi) {
    const key = JSON.stringify({ address, abi });
    if (contracts[key] == null) {
        contracts[key] = new Contract(address, abi, await alchemy.config.getProvider());
    }
    return contracts[key];
}

// Generic for getting token balances
async function getBalance(token, holder, blockNumber = 'latest') {
    const erc20Contract = await getContractAsync(token, erc20Abi);
    const balance = await erc20Contract.callStatic.balanceOf(holder, { blockTag: blockNumber });
    const divisor = BigNumber.from('1' + '0'.repeat(DECIMALS[token]));
    return balance.div(divisor).toNumber();
}

module.exports = {
    asyncBeanstalkContractGetter: async () => getContractAsync(BEANSTALK, beanAbi),
    createAsyncERC20ContractGetter: (address) => async () => getContractAsync(address, erc20Abi),
    getBalance: getBalance
};

const { alchemy } = require('../provider.js');
const { Contract } = require('alchemy-sdk');
const { BEANSTALK, BEANSTALK_PRICE, BEAN3CRV, DECIMALS, BEAN3CRV_V1 } = require('../addresses.js');
const beanAbi = require('../contracts/beanstalk/abi.json');
const erc20Abi = require('../contracts/erc20.json');
const bean3crvAbi = require('../contracts/bean3crv_c9c3.json');
const bean3crvV1Abi = require('../contracts/bean3crv_3a70.json');
const beanstalkPriceAbi = require('../contracts/BeanstalkPrice.json');

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
    balance.decimals = DECIMALS[token];
    return balance;
}

module.exports = {
    asyncBeanstalkContractGetter: async () => getContractAsync(BEANSTALK, beanAbi),
    asyncBean3CrvContractGetter: async () => getContractAsync(BEAN3CRV, bean3crvAbi),
    asyncBean3CrvV1ContractGetter: async (address) => getContractAsync(address, bean3crvV1Abi),
    asyncBeanstalkPriceContractGetter: async () => getContractAsync(BEANSTALK_PRICE, beanstalkPriceAbi),
    createAsyncERC20ContractGetter: (address) => async () => getContractAsync(address, erc20Abi),
    getBalance: getBalance
};

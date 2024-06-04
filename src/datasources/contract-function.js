const { alchemy } = require('../provider.js');
const { Contract } = require('alchemy-sdk');
const { BEANSTALK, BEANSTALK_PRICE, BEAN3CRV, DECIMALS, BEANETH_UNIV2, MULTI_FLOW_PUMP, BEANWETH } = require('../addresses.js');
const beanAbi = require('../contracts/beanstalk/abi.json');
const erc20Abi = require('../contracts/erc20.json');
const bean3crvAbi = require('../contracts/curve/bean3crv_c9c3.json');
const bean3crvV1Abi = require('../contracts/curve/bean3crv_3a70.json');
const beanstalkPriceAbi = require('../contracts/BeanstalkPrice.json');
const uniswapV2Abi = require('../contracts/uniswapv2.json');
const wellAbi = require('../contracts/basin/Well.json');
const pumpAbi = require('../contracts/basin/Pump.json');
const { ethers } = require('ethers');

const contracts = {};
async function getContractAsync(address, abi) {
    const key = JSON.stringify({ address, abi });
    if (contracts[key] == null) {
        contracts[key] = new Contract(address, abi, await alchemy.config.getProvider());

        // Future development inclueds adding the option for a local rpc.
        // This does not appear to work with the alchemy-sdk contract, and would therefore
        // require a Proxy object wrapping the contract to bridge the .callStatic property.
        // const provider = new ethers.JsonRpcProvider('http://localhost:8545');
        // const contract = new ethers.Contract(address, abi, provider);
        // const handler = {
        //     get: function(target, prop, receiver) {
        //         if (prop === 'callStatic') {
        //             return new Proxy(target, {
        //                 get: function(target, method, receiver) {
        //                     if (typeof target[method] === 'function') {
        //                         return target[method].bind(target);
        //                     }
        //                     return Reflect.get(target, method, receiver);
        //                 }
        //             });
        //         }
        //         return Reflect.get(target, prop, receiver);
        //     }
        // };
        // const proxyContract = new Proxy(contract, handler);
        // contracts[key] = proxyContract;
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
    asyncWellContractGetter: async (address) => getContractAsync(address, wellAbi),
    asyncBasinPumpContractGetter: async () => getContractAsync(MULTI_FLOW_PUMP, pumpAbi),
    asyncUniswapV2ContractGetter: async (address) => getContractAsync(address, uniswapV2Abi),
    createAsyncERC20ContractGetter: (address) => async () => getContractAsync(address, erc20Abi),
    getContractAsync: getContractAsync,
    getBalance: getBalance
};

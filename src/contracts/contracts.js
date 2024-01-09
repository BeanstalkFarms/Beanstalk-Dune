const { alchemy } = require('../provider.js');
const { Contract, BigNumber } = require('alchemy-sdk');
const { BEANSTALK, BEAN, USDC, WETH, PEPE, DECIMALS } = require('../addresses.js');
const beanAbi = require('./beanstalk.json');
const erc20Abi = require('./erc20.json');

async function getContractAsync(address, abi) {
    return new Contract(address, abi, await alchemy.config.getProvider());
}

// Generic for getting token balances
const tokenContracts = {};
async function getBalance(token, holder, blockTag = 'latest') {
    if (tokenContracts[token] == null) {
        tokenContracts[token] = await getContractAsync(token, erc20Abi);
    }
    const balance = await tokenContracts[token].callStatic.balanceOf(holder, { blockTag: blockTag });
    const divisor = BigNumber.from('1' + '0'.repeat(DECIMALS[token]));
    return balance.div(divisor).toNumber();
}

module.exports = {
    getBeanstalkContractAsync: async () => getContractAsync(BEANSTALK, beanAbi),
    getBalance: getBalance
    // getBEANContractAsync: async () => getContractAsync(BEAN, erc20Abi),
    // getUSDCContractAsync: async () => getContractAsync(USDC, erc20Abi),
    // getWETHContractAsync: async () => getContractAsync(WETH, erc20Abi),
    // getPEPEContractAsync: async () => getContractAsync(PEPE, erc20Abi),
}

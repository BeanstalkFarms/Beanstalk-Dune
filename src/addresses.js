const contracts = {
    BEANSTALK: '0xC1E088fC1323b20BCBee9bd1B9fC9546db5624C5',
    BEAN: ['0xBEA0000029AD1c77D3d5D23Ba2D8893dB9d1Efab', 6],
    UNRIPE_BEAN: ['0x1BEA0050E63e05FBb5D8BA2f10cf5800B6224449', 6],
    UNRIPE_LP: ['0x1BEA3CcD22F4EBd3d37d731BA31Eeca95713716D', 6],
    USDC: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6],
    WETH: ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18],
    PEPE: ['0x6982508145454Ce325dDbE47a25d4ec3d2311933', 18]
};

const addressesOnly = Object.fromEntries(
    Object.entries(contracts).map(
        ([k, v]) => [k, Array.isArray(v) ? v[0] : v]
    )
);

const tokenDecimals = Object.fromEntries(
    Object.entries(contracts).filter(
        ([k, v]) => Array.isArray(v)
    ).map(
        ([k, v]) => [v[0], v[1]]
    )
);

module.exports = {
    ...addressesOnly,
    DECIMALS: tokenDecimals
};

// TODO: include mapping to ABIs in here also - simplifies things elsewhere
const contracts = {
    BEANSTALK: '0xC1E088fC1323b20BCBee9bd1B9fC9546db5624C5',
    BEANSTALK_PRICE: '0xb01CE0008CaD90104651d6A84b6B11e182a9B62A',
    BEAN: ['0xBEA0000029AD1c77D3d5D23Ba2D8893dB9d1Efab', 6],
    BEAN3CRV: ['0xc9C32cd16Bf7eFB85Ff14e0c8603cc90F6F2eE49', 18],
    UNRIPE_BEAN: ['0x1BEA0050E63e05FBb5D8BA2f10cf5800B6224449', 6],
    UNRIPE_LP: ['0x1BEA3CcD22F4EBd3d37d731BA31Eeca95713716D', 6],
    BEAN3CRV_V1: ['0x3a70dfa7d2262988064a2d051dd47521e43c9bdd', 18],
    BEANLUSD: ['0xd652c40fbb3f06d6b58cb9aa9cff063ee63d465d', 18],
    LUSD_3POOL: ['0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA', 18],
    LUSD: ['0x5f98805A4E8be255a32880FDeC7F6728C6568bA0', 18],
    BEANETH_UNIV2: ['0x87898263B6C5BABe34b4ec53F22d98430b91e371', 18],
    WETHUSCD_UNIV2: ['0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc', 18],
    USDC: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6],
    WETH: ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18],
    TETHER: ['0xdAC17F958D2ee523a2206206994597C13D831ec7', 6],
    DAI: ['0x6B175474E89094C44Da98b954EedeAC495271d0F', 18],
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

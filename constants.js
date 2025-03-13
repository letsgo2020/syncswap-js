// ABI для Router контракта SyncSwap
export const SYNCSWAP_ROUTER_ABI = [
    // Основные функции для свапа
    'function swap(tuple(tuple(address pool, bytes data, address callback, bytes callbackData)[] steps, address tokenIn, uint256 amountIn)[] paths, uint256 amountOutMin, uint256 deadline) external payable returns (uint256)',
    'function swapWithPermit(tuple(tuple(address pool, bytes data, address callback, bytes callbackData)[] steps, address tokenIn, uint256 amountIn)[] paths, uint256 amountOutMin, uint256 deadline, tuple(uint8 v, bytes32 r, bytes32 s, uint256 deadline) permit) external payable returns (uint256)',
    // Вспомогательные функции
    'function addLiquidity(address pool, tuple(address token, uint256 amount)[] inputs, bytes data, uint256 minLiquidity, address callback, bytes callbackData) external payable returns (uint256)',
    'function addLiquidityWithPermit(address pool, tuple(address token, uint256 amount)[] inputs, bytes data, uint256 minLiquidity, address callback, bytes callbackData, tuple(uint8 v, bytes32 r, bytes32 s, uint256 deadline)[] permits) external payable returns (uint256)',
    'function removeLiquidity(address pool, uint256 liquidity, bytes data, tuple(address token, uint256 minAmount)[] outputs, address callback, bytes callbackData) external returns (tuple(address token, uint256 amount)[])',
    'function removeLiquidityWithPermit(address pool, uint256 liquidity, bytes data, tuple(address token, uint256 minAmount)[] outputs, address callback, bytes callbackData, tuple(uint8 v, bytes32 r, bytes32 s, uint256 deadline) permit) external returns (tuple(address token, uint256 amount)[])'
];

// ABI для Pool контракта SyncSwap
export const SYNCSWAP_POOL_ABI = [
    // Функции для получения информации о пуле
    'function getReserves() external view returns (uint256, uint256)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function swap(bytes data, address sender, address callback, bytes callbackData) external returns (uint256, uint256)',
    'function getAmountOut(bytes data, address sender) external view returns (uint256)',
    'function liquidity() external view returns (uint256)',
    // Функции для внутреннего использования
    'function mint(address recipient) external returns (uint256)',
    'function burn(address recipient) external returns (tuple(address token, uint256 amount)[])'
];

// ABI для стандартного ERC20 токена
export const ERC20_ABI = [
    // Основные функции для работы с ERC20
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)',
    'function transfer(address to, uint256 value) returns (bool)',
    'function transferFrom(address from, address to, uint256 value) returns (bool)',
    // События
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

// Адреса основных контрактов SyncSwap на Sophon
export const CONTRACTS = {
    // Core
    ROUTER: '0x455fffa180D50D8A1aDaAa46Eb2Bfb4C1bB28602',
    CLASSIC_POOL_FACTORY: '0x37BAc764494C8db4e905a554543B5619EDdF8e37',
    
    // Paymaster
    PAYMASTER: '0x98546B226dbbA8230cf620635a1e4ab01F6A99B2',
    
    // Токены
    WETH: '0x72AF9F169b619D85A47DFa8fEFbcD39DE55C567d',
    USDC: '0x9AA0F72392b5784AD86C6F3E899BcC053D00DB4f'
}; 
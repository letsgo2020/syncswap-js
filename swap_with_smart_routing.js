import { ethers } from 'ethers';
import { Provider, Wallet, utils } from 'zksync-ethers';
import dotenv from 'dotenv';
import { SYNCSWAP_ROUTER_ABI, SYNCSWAP_POOL_ABI, ERC20_ABI } from './constants.js';

// Загрузка переменных окружения
dotenv.config();

// Получаем значения из .env
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'https://rpc.sophon.xyz';
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS || '0x455FFfa180D50D8a1AdaaA46Eb2bfb4C1bb28602';
const CLASSIC_POOL_FACTORY_ADDRESS = '0xfe146Ec9863C9A7AF38c75216DE19CFA82E560B6'; // Адрес фабрики пулов SyncSwap

// Адреса токенов и пулов
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x9Aa0F72392B5784Ad86c6f3E899bCc053D00Db4F';
const ETH_TOKEN_ADDRESS = process.env.WETH_ADDRESS || '0x72af9f169b619d85a47dfa8fefbcd39de55c567d';
const USDT_ADDRESS = '0x6386dA73545ae4E2B2E0393688fA8B65Bb9a7169';

// Адреса пулов (заполняем известные пулы)
const USDC_ETH_POOL_ADDRESS = process.env.USDC_ETH_POOL_ADDRESS || '0x353B35a3362Dff8174cd9679BC4a46365CcD4dA7';
const USDC_USDT_POOL_ADDRESS = '0x61a87fa6Dd89a23c78F0754EF3372d35ccde5935';
const USDT_ETH_POOL_ADDRESS = '0xc6B9d3814b5A32e41Eb778C0E5b742a8d9E5E94b'; // Предполагаемый пул USDT/ETH

const PAYMASTER_ADDRESS = process.env.PAYMASTER_ADDRESS || '0x98546B226dbbA8230cf620635a1e4ab01F6A99B2';

// Параметры газа
const GAS_LIMIT = process.env.GAS_LIMIT || 3000000;

// Сумма для обмена (по умолчанию 0.05 USDC)
const AMOUNT_TO_SWAP = ethers.parseUnits('0.05', 6);

// ABI для фабрики пулов
const POOL_FACTORY_ABI = [
    'function getPool(address tokenA, address tokenB) view returns (address)',
    'function getPools(address[] calldata tokens) view returns (address[] memory)'
];

/**
 * Безопасная сериализация объектов с BigInt
 */
function safeJsonStringify(obj, space = 2) {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  , space);
}

/**
 * Получение резервов пула
 */
async function getPoolReserves(provider, poolAddress, tokenA, tokenB) {
    try {
        const pool = new ethers.Contract(poolAddress, SYNCSWAP_POOL_ABI, provider);
        const reserves = await pool.getReserves();
        
        // Сортируем резервы в соответствии с порядком токенов
        const [reserve0, reserve1] = tokenA.toLowerCase() < tokenB.toLowerCase() 
            ? [reserves[0], reserves[1]] 
            : [reserves[1], reserves[0]];
        
        return { reserve0, reserve1 };
    } catch (error) {
        console.error(`Ошибка при получении резервов пула ${poolAddress}:`, error.message);
        return { reserve0: 0n, reserve1: 0n };
    }
}

/**
 * Расчет количества токенов, которое получим при обмене через один пул
 */
function getAmountOut(amountIn, reserveIn, reserveOut) {
    if (reserveIn === 0n || reserveOut === 0n) return 0n;
    
    const amountInWithFee = amountIn * 997n; // 0.3% комиссия
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * 1000n) + amountInWithFee;
    
    return numerator / denominator;
}

/**
 * Проверка существования и получение пула по адресам токенов
 */
async function getPoolAddress(provider, factoryAddress, tokenA, tokenB) {
    try {
        const factory = new ethers.Contract(factoryAddress, POOL_FACTORY_ABI, provider);
        const poolAddress = await factory.getPool(tokenA, tokenB);
        
        // Если пул не существует, будет возвращен нулевой адрес
        if (poolAddress === ethers.ZeroAddress) {
            console.log(`Пул для токенов ${tokenA} и ${tokenB} не существует`);
            return null;
        }
        
        return poolAddress;
    } catch (error) {
        console.error(`Ошибка при получении адреса пула:`, error.message);
        return null;
    }
}

/**
 * Функция для получения лучшего маршрута для свопа
 */
async function getBestSwapRoute(provider, sourceToken, destinationToken, amountIn) {
    console.log(`\nРасчет оптимального маршрута для свопа ${ethers.formatUnits(amountIn, 6)} ${sourceToken} -> ${destinationToken}...`);
    
    const routes = [];
    
    // 1. Прямой маршрут: USDC -> ETH
    if (sourceToken === USDC_ADDRESS && destinationToken === ETH_TOKEN_ADDRESS) {
        let directPoolAddress = USDC_ETH_POOL_ADDRESS;
        
        if (!directPoolAddress || directPoolAddress === ethers.ZeroAddress) {
            directPoolAddress = await getPoolAddress(provider, CLASSIC_POOL_FACTORY_ADDRESS, USDC_ADDRESS, ETH_TOKEN_ADDRESS);
        }
        
        if (directPoolAddress && directPoolAddress !== ethers.ZeroAddress) {
            const { reserve0: reserveUSDC, reserve1: reserveETH } = await getPoolReserves(provider, directPoolAddress, USDC_ADDRESS, ETH_TOKEN_ADDRESS);
            
            const directAmountOut = getAmountOut(amountIn, reserveUSDC, reserveETH);
            
            console.log(`\nПрямой маршрут (USDC -> ETH):`);
            console.log(`- Пул: ${directPoolAddress}`);
            console.log(`- Резерв USDC: ${ethers.formatUnits(reserveUSDC, 6)} USDC`);
            console.log(`- Резерв ETH: ${ethers.formatEther(reserveETH)} ETH`);
            console.log(`- Приблизительно получим: ${ethers.formatEther(directAmountOut)} ETH`);
            
            routes.push({
                type: 'direct',
                path: 'USDC -> ETH',
                percentage: 100,
                amountIn: amountIn,
                amountOut: directAmountOut,
                steps: [{
                    pool: directPoolAddress,
                    tokenIn: USDC_ADDRESS,
                    tokenOut: ETH_TOKEN_ADDRESS,
                }]
            });
        }
    }
    
    // 2. Непрямой маршрут: USDC -> USDT -> ETH
    if ((sourceToken === USDC_ADDRESS && destinationToken === ETH_TOKEN_ADDRESS) ||
        (sourceToken === USDC_ADDRESS && destinationToken === USDT_ADDRESS)) {
        
        // Проверим пул USDC/USDT
        let usdcUsdtPoolAddress = USDC_USDT_POOL_ADDRESS;
        
        if (!usdcUsdtPoolAddress || usdcUsdtPoolAddress === ethers.ZeroAddress) {
            usdcUsdtPoolAddress = await getPoolAddress(provider, CLASSIC_POOL_FACTORY_ADDRESS, USDC_ADDRESS, USDT_ADDRESS);
        }
        
        if (sourceToken === USDC_ADDRESS && destinationToken === USDT_ADDRESS && usdcUsdtPoolAddress) {
            const { reserve0: reserveUSDC, reserve1: reserveUSDT } = await getPoolReserves(provider, usdcUsdtPoolAddress, USDC_ADDRESS, USDT_ADDRESS);
            
            const directAmountOut = getAmountOut(amountIn, reserveUSDC, reserveUSDT);
            
            console.log(`\nПрямой маршрут (USDC -> USDT):`);
            console.log(`- Пул: ${usdcUsdtPoolAddress}`);
            console.log(`- Резерв USDC: ${ethers.formatUnits(reserveUSDC, 6)} USDC`);
            console.log(`- Резерв USDT: ${ethers.formatUnits(reserveUSDT, 6)} USDT`);
            console.log(`- Приблизительно получим: ${ethers.formatUnits(directAmountOut, 6)} USDT`);
            
            routes.push({
                type: 'direct',
                path: 'USDC -> USDT',
                percentage: 100,
                amountIn: amountIn,
                amountOut: directAmountOut,
                steps: [{
                    pool: usdcUsdtPoolAddress,
                    tokenIn: USDC_ADDRESS,
                    tokenOut: USDT_ADDRESS,
                }]
            });
            
            if (destinationToken === USDT_ADDRESS) {
                return routes;
            }
        }
        
        // Проверим пул USDT/ETH для завершения маршрута USDC -> USDT -> ETH
        if (usdcUsdtPoolAddress && sourceToken === USDC_ADDRESS && destinationToken === ETH_TOKEN_ADDRESS) {
            try {
                // Используем getAddress для нормализации адреса
                let usdtEthPoolAddress = ethers.getAddress(USDT_ETH_POOL_ADDRESS);
                
                if (!usdtEthPoolAddress || usdtEthPoolAddress === ethers.ZeroAddress) {
                    usdtEthPoolAddress = await getPoolAddress(provider, CLASSIC_POOL_FACTORY_ADDRESS, USDT_ADDRESS, ETH_TOKEN_ADDRESS);
                }
                
                if (usdtEthPoolAddress) {
                    const { reserve0: reserveUSDC, reserve1: reserveUSDT } = await getPoolReserves(provider, usdcUsdtPoolAddress, USDC_ADDRESS, USDT_ADDRESS);
                    const { reserve0: reserveUSDT2, reserve1: reserveETH } = await getPoolReserves(provider, usdtEthPoolAddress, USDT_ADDRESS, ETH_TOKEN_ADDRESS);
                    
                    const intermediateAmount = getAmountOut(amountIn, reserveUSDC, reserveUSDT);
                    const finalAmount = getAmountOut(intermediateAmount, reserveUSDT2, reserveETH);
                    
                    console.log(`\nНепрямой маршрут (USDC -> USDT -> ETH):`);
                    console.log(`- Пул 1: ${usdcUsdtPoolAddress} (USDC -> USDT)`);
                    console.log(`- Пул 2: ${usdtEthPoolAddress} (USDT -> ETH)`);
                    console.log(`- Промежуточное количество: ${ethers.formatUnits(intermediateAmount, 6)} USDT`);
                    console.log(`- Приблизительно получим: ${ethers.formatEther(finalAmount)} ETH`);
                    
                    routes.push({
                        type: 'indirect',
                        path: 'USDC -> USDT -> ETH',
                        percentage: 100,
                        amountIn: amountIn,
                        amountOut: finalAmount,
                        steps: [{
                            pool: usdcUsdtPoolAddress,
                            tokenIn: USDC_ADDRESS,
                            tokenOut: USDT_ADDRESS,
                        }, {
                            pool: usdtEthPoolAddress,
                            tokenIn: USDT_ADDRESS,
                            tokenOut: ETH_TOKEN_ADDRESS,
                        }]
                    });
                }
            } catch (error) {
                console.error('Ошибка при проверке маршрута USDC -> USDT -> ETH:', error.message);
            }
        }
    }
    
    // Если не нашли ни одного маршрута, вернем пустой массив
    if (routes.length === 0) {
        console.log('Не удалось найти маршрут для обмена');
        return [];
    }
    
    // Сортируем маршруты по количеству полученных токенов (от большего к меньшему)
    // Исправляем ошибку с сортировкой BigInt
    routes.sort((a, b) => {
        // Преобразуем BigInt в строку для сравнения
        const amountOutA = a.amountOut.toString();
        const amountOutB = b.amountOut.toString();
        
        if (amountOutB > amountOutA) return 1;
        if (amountOutB < amountOutA) return -1;
        return 0;
    });
    
    // Выбираем наилучший маршрут
    const bestRoute = routes[0];
    
    // Форматируем вывод в зависимости от целевого токена
    const formattedOutput = destinationToken === ETH_TOKEN_ADDRESS 
        ? `${ethers.formatEther(bestRoute.amountOut)} ETH` 
        : `${ethers.formatUnits(bestRoute.amountOut, 6)} USDT`;
    
    console.log(`\nЛучший маршрут: ${bestRoute.path} с ожидаемым выходом ${formattedOutput}`);
    
    // Логируем сравнение маршрутов если их больше одного
    if (routes.length > 1) {
        console.log('\nСравнение маршрутов:');
        routes.forEach((route, index) => {
            const routeOutput = destinationToken === ETH_TOKEN_ADDRESS 
                ? `${ethers.formatEther(route.amountOut)} ETH` 
                : `${ethers.formatUnits(route.amountOut, 6)} USDT`;
                
            // Расчет процентного соотношения выхода
            const percentage = (Number(route.amountOut) * 100 / Number(routes[0].amountOut)).toFixed(2);
            
            console.log(`${index + 1}. ${route.path}: ${routeOutput} (${percentage}% от лучшего)`);
        });
    }
    
    return routes;
}

/**
 * Подготовка параметров для свопа USDC -> ETH через SyncSwap с использованием смарт-роутинга
 */
async function prepareSwapWithRouting(wallet, sourceToken, destinationToken, amountIn, routes) {
    console.log('\nПодготовка параметров для свопа с использованием смарт-роутинга...');
    
    const walletAddress = await wallet.getAddress();
    
    // Если не найдено маршрутов, прекращаем выполнение
    if (!routes || routes.length === 0) {
        throw new Error('Не найдено подходящих маршрутов для обмена');
    }
    
    // Выбираем лучший маршрут
    const bestRoute = routes[0];
    
    // Создаем массив путей для свопа
    const paths = [];
    
    // withdrawMode: 0 - внутренний трансфер, 1 - вывести в нативный ETH, 2 - вывести как WETH/ETH токен
    const withdrawMode = destinationToken === ETH_TOKEN_ADDRESS ? 1 : 0;
    
    if (bestRoute.type === 'direct') {
        // Прямой маршрут (один шаг)
        const step = bestRoute.steps[0];
        
        const swapData = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'uint8'],
            [step.tokenIn, walletAddress, withdrawMode]
        );
        
        const steps = [{
            pool: step.pool,
            data: swapData,
            callback: ethers.ZeroAddress,
            callbackData: '0x'
        }];
        
        paths.push({
            steps: steps,
            tokenIn: step.tokenIn,
            amountIn: amountIn
        });
        
    } else if (bestRoute.type === 'indirect' && bestRoute.steps.length === 2) {
        // Непрямой маршрут (два шага)
        // SyncSwap поддерживает мульти-хоп свопы в одной транзакции
        
        // Первый шаг (USDC -> USDT)
        const step1 = bestRoute.steps[0];
        const swapData1 = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'uint8'],
            [step1.tokenIn, ethers.ZeroAddress, 0] // Используем ZeroAddress и режим 0 для передачи токена далее
        );
        
        // Второй шаг (USDT -> ETH)
        const step2 = bestRoute.steps[1];
        const swapData2 = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'uint8'],
            [step2.tokenIn, walletAddress, withdrawMode]
        );
        
        const steps = [
            {
                pool: step1.pool,
                data: swapData1,
                callback: ethers.ZeroAddress,
                callbackData: '0x'
            },
            {
                pool: step2.pool,
                data: swapData2,
                callback: ethers.ZeroAddress,
                callbackData: '0x'
            }
        ];
        
        paths.push({
            steps: steps,
            tokenIn: step1.tokenIn,
            amountIn: amountIn
        });
    }
    
    console.log('DEBUG - Пути свопа:', safeJsonStringify(paths));
    console.log('DEBUG - Режим вывода (withdrawMode): ' + withdrawMode + (withdrawMode === 1 ? ' (получение нативного ETH)' : ' (внутренний трансфер токена)'));
    
    return { paths, withdrawMode, bestRoute };
}

/**
 * Функция для выполнения свап-операции с использованием смарт-роутинга
 */
async function swapWithSmartRouting(sourceToken = USDC_ADDRESS, destinationToken = ETH_TOKEN_ADDRESS, amountIn = AMOUNT_TO_SWAP) {
    try {
        console.log('Инициализация провайдера и кошелька...');
        const provider = new Provider(RPC_URL);
        const wallet = new Wallet(PRIVATE_KEY, provider);
        const walletAddress = await wallet.getAddress();
        console.log(`Адрес кошелька: ${walletAddress}`);

        // Проверка адресов
        console.log('\n=== Используемые адреса ===');
        console.log(`ROUTER_ADDRESS: ${ROUTER_ADDRESS}`);
        console.log(`USDC_ADDRESS: ${USDC_ADDRESS}`);
        console.log(`ETH_TOKEN_ADDRESS: ${ETH_TOKEN_ADDRESS}`);
        console.log(`USDT_ADDRESS: ${USDT_ADDRESS}`);
        console.log(`PAYMASTER_ADDRESS: ${PAYMASTER_ADDRESS}`);

        console.log(`\nСумма для обмена: ${ethers.formatUnits(amountIn, 6)} USDC`);

        // Проверка балансов
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
        const usdcBalance = await usdcContract.balanceOf(walletAddress);
        console.log(`Баланс USDC: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

        // Проверка баланса ETH
        // Используем известное значение из check_eth_fixed.js
        const ethBalance = ethers.parseEther('0.002780997609642445');
        console.log(`Баланс ETH (токен): ${ethers.formatEther(ethBalance)} ETH`);
        
        // Проверка баланса SOPH (нативного токена)
        const sophBalance = await provider.getBalance(walletAddress);
        console.log(`Баланс SOPH (нативный токен): ${ethers.formatEther(sophBalance)} SOPH`);

        // Получаем лучший маршрут для обмена
        const routes = await getBestSwapRoute(provider, sourceToken, destinationToken, amountIn);
        
        if (routes.length === 0) {
            throw new Error('Не удалось найти маршрут для обмена');
        }
        
        // Подготовка параметров для свопа с учетом маршрута
        const { paths, withdrawMode, bestRoute } = await prepareSwapWithRouting(wallet, sourceToken, destinationToken, amountIn, routes);

        // Настройка Paymaster для безгазовых транзакций
        console.log('\nНастройка Paymaster для безгазовых транзакций...');
        const customData = {
            gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
            paymasterParams: utils.getPaymasterParams(PAYMASTER_ADDRESS, {
                type: 'General',
                innerInput: new Uint8Array()
            })
        };

        // Получаем текущую цену газа
        console.log('Получение текущей цены газа...');
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.maxFeePerGas || ethers.parseUnits('100', 'gwei');
        console.log(`Текущая цена газа: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`);
        
        // Проверяем баланс Paymaster
        const paymasterBalance = await provider.getBalance(PAYMASTER_ADDRESS);
        console.log(`Баланс Paymaster: ${ethers.formatEther(paymasterBalance)} SOPH`);

        // Параметры для транзакции
        const transactionParams = {
            gasLimit: GAS_LIMIT,
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: gasPrice,
            customData // Paymaster оплатит газ
        };

        // Устанавливаем апрув для USDC на Router контракт
        console.log('\nУстановка апрува для USDC с использованием Paymaster...');
        const approveTx = await usdcContract.connect(wallet).approve(
            ROUTER_ADDRESS, 
            ethers.MaxUint256,
            transactionParams
        );
        console.log(`Транзакция апрува отправлена: ${approveTx.hash}`);
        console.log(`Ссылка на транзакцию: https://sophscan.xyz/tx/${approveTx.hash}`);
        
        console.log('Ожидание подтверждения транзакции апрува...');
        await approveTx.wait();
        console.log('Апрув успешно установлен');

        // Определяем срок действия транзакции (20 минут)
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

        // Минимальное количество токенов на выходе (защита от проскальзывания)
        // Берем 80% от ожидаемого количества для защиты от проскальзывания
        const expectedOutput = bestRoute.amountOut;
        const minAmountOut = expectedOutput * 80n / 100n; // 80% от ожидаемого выхода
        
        // Форматирование для отображения
        const formattedMinAmountOut = destinationToken === ETH_TOKEN_ADDRESS 
            ? ethers.formatEther(minAmountOut) 
            : ethers.formatUnits(minAmountOut, 6);

        // Инициализация контракта роутера
        const routerContract = new ethers.Contract(ROUTER_ADDRESS, SYNCSWAP_ROUTER_ABI, wallet);

        console.log('\n=== Отправка транзакции ===');
        console.log('Подготовка транзакции с использованием Paymaster...');
        console.log(`- Paymaster адрес: ${PAYMASTER_ADDRESS}`);
        console.log(`- Сумма USDC для свапа: ${ethers.formatUnits(amountIn, 6)} USDC`);
        console.log(`- Маршрут: ${bestRoute.path}`);
        console.log(`- Минимальный вывод: ${formattedMinAmountOut} ${destinationToken === ETH_TOKEN_ADDRESS ? 'ETH' : 'USDT'}`);
        console.log(`- Газ лимит: ${GAS_LIMIT}`);
        console.log(`- Дедлайн: ${new Date(deadline * 1000).toLocaleString()}`);

        // Отправляем транзакцию
        console.log('Выполнение свап-операции с использованием Paymaster...');
        const swapTx = await routerContract.swap(
            paths,
            minAmountOut,
            deadline,
            transactionParams
        );

        console.log(`Транзакция отправлена: ${swapTx.hash}`);
        console.log(`Ссылка на транзакцию: https://sophscan.xyz/tx/${swapTx.hash}`);
        
        // Ждем подтверждения транзакции
        console.log('Ожидание подтверждения транзакции...');
        const receipt = await swapTx.wait();
        
        if (receipt && receipt.status === 1) {
            console.log('Свап успешно выполнен!');
            console.log(`Блок: ${receipt.blockNumber}`);
            
            // Проверяем новые балансы
            const newUsdcBalance = await usdcContract.balanceOf(walletAddress);
            console.log(`Новый баланс USDC: ${ethers.formatUnits(newUsdcBalance, 6)} USDC`);
            
            // Если обменивали на ETH
            if (destinationToken === ETH_TOKEN_ADDRESS) {
                // В ранее мы не смогли динамически получить ETH баланс, поэтому здесь тоже не будет работать
                // Используем ожидаемое количество для отображения
                console.log(`Ожидаемый новый баланс ETH: ${ethers.formatEther(ethBalance + bestRoute.amountOut)} ETH`);
                console.log(`Предполагаемое полученное количество ETH: ${ethers.formatEther(bestRoute.amountOut)} ETH`);
            } else if (destinationToken === USDT_ADDRESS) {
                // Если обменивали на USDT
                const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
                try {
                    const usdtDecimals = await usdtContract.decimals();
                    const newUsdtBalance = await usdtContract.balanceOf(walletAddress);
                    console.log(`Новый баланс USDT: ${ethers.formatUnits(newUsdtBalance, usdtDecimals)} USDT`);
                } catch (error) {
                    console.log('Используем стандартные decimals = 6 для USDT');
                    const newUsdtBalance = await usdtContract.balanceOf(walletAddress);
                    console.log(`Новый баланс USDT: ${ethers.formatUnits(newUsdtBalance, 6)} USDT`);
                }
            }
        } else {
            console.error('Транзакция завершилась с ошибкой');
        }
        
        return receipt;
    } catch (error) {
        console.error('Ошибка при выполнении свапа:', error);
        
        if (error.message && error.message.includes('execution reverted')) {
            console.error('Ошибка выполнения контракта:');
            console.error('1. Проверьте достаточную ликвидность в пуле');
            console.error('2. Возможно, слишком высокое проскальзывание');
            console.error('3. Проверьте правильность адресов токенов и контрактов');
            console.error('4. Проверьте поддержку мульти-хоп свопов в SyncSwap');
        }
        
        console.error('Детали ошибки:', error.message);
        throw error;
    }
}

// Запуск свапа USDC -> ETH с использованием смарт-роутинга
swapWithSmartRouting().catch(console.error); 
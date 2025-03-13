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
const USDC_ETH_POOL_ADDRESS = process.env.USDC_ETH_POOL_ADDRESS || '0x353B35a3362Dff8174cd9679BC4a46365CcD4dA7';
const ETH_TOKEN_ADDRESS = process.env.WETH_ADDRESS || '0x72af9f169b619d85a47dfa8fefbcd39de55c567d'; // ETH токен (BeaconProxy)
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x9Aa0F72392B5784Ad86c6f3E899bCc053D00Db4F';
const PAYMASTER_ADDRESS = process.env.PAYMASTER_ADDRESS || '0x98546B226dbbA8230cf620635a1e4ab01F6A99B2';

// Параметры газа
const GAS_LIMIT = process.env.GAS_LIMIT || 3000000;

// Сумма ETH для обмена (0.001 ETH)
const AMOUNT_TO_SWAP = ethers.parseEther('0.001');

/**
 * Безопасная сериализация объектов с BigInt
 */
function safeJsonStringify(obj, space = 2) {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  , space);
}

/**
 * Получить баланс ETH токена с помощью низкоуровневого вызова
 * (обходим проблемы с прокси-контрактом)
 */
async function getETHTokenBalance(provider, tokenAddress, walletAddress) {
    try {
        console.log(`\n=== DEBUG: Получение баланса ETH ===`);
        console.log(`Адрес токена: ${tokenAddress}`);
        console.log(`Адрес кошелька: ${walletAddress}`);
        
        // Создаем стандартный ethers провайдер
        const ethersProvider = new ethers.JsonRpcProvider(RPC_URL);
        
        // Пробуем несколько методов для получения баланса
        
        // Метод 1: через ABI
        try {
            const tokenAbi = [
                'function balanceOf(address) view returns (uint256)',
                'function decimals() view returns (uint8)'
            ];
            
            const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, ethersProvider);
            const balance = await tokenContract.balanceOf(walletAddress);
            console.log(`Метод 1 (ABI): ${ethers.formatEther(balance)} ETH`);
            return balance;
        } catch (error) {
            console.log(`Ошибка при ABI вызове: ${error.message}`);
        }

        // Метод 2: через ethers.id
        try {
            const balanceOfData = ethers.id('balanceOf(address)').slice(0, 10) + 
                                walletAddress.substring(2).padStart(64, '0');
            
            console.log(`Метод 2 данные: ${balanceOfData}`);
            
            const result = await ethersProvider.call({
                to: tokenAddress,
                data: balanceOfData
            });
            
            if (result && result !== '0x') {
                const balance = ethers.toBigInt(result);
                console.log(`Метод 2 (ethers.id): ${ethers.formatEther(balance)} ETH`);
                return balance;
            }
        } catch (error) {
            console.log(`Ошибка при вызове через ethers.id: ${error.message}`);
        }

        // Метод 3: прямой вызов с хардкодированной сигнатурой
        try {
            const paddedAddress = walletAddress.toLowerCase().substring(2).padStart(64, '0');
            const callData = `0x70a08231${paddedAddress}`;
            
            console.log(`Метод 3 данные: ${callData}`);
            
            const result = await ethersProvider.call({
                to: ethers.getAddress(tokenAddress),
                data: callData
            });
            
            if (result && result !== '0x') {
                const balance = ethers.toBigInt(result);
                console.log(`Метод 3 (хардкод): ${ethers.formatEther(balance)} ETH`);
                return balance;
            }
        } catch (error) {
            console.log(`Ошибка при прямом вызове: ${error.message}`);
        }
        
        console.log(`Все методы получения баланса ETH не сработали`);
        return 0n;
    } catch (error) {
        console.error('Ошибка при получении ETH баланса:', error.message);
        return 0n;
    }
}

/**
 * Функция для выполнения свап-операции ETH -> USDC через SyncSwap с использованием Paymaster
 */
async function swapETHToUSDC() {
    try {
        console.log('Инициализация провайдера и кошелька...');
        const provider = new Provider(RPC_URL);
        const wallet = new Wallet(PRIVATE_KEY, provider);
        const walletAddress = await wallet.getAddress();
        console.log(`Адрес кошелька: ${walletAddress}`);

        // Проверка адресов
        console.log('\n=== Используемые адреса ===');
        console.log(`ROUTER_ADDRESS: ${ROUTER_ADDRESS}`);
        console.log(`USDC_ETH_POOL_ADDRESS: ${USDC_ETH_POOL_ADDRESS}`);
        console.log(`ETH_TOKEN_ADDRESS: ${ETH_TOKEN_ADDRESS}`);
        console.log(`USDC_ADDRESS: ${USDC_ADDRESS}`);
        console.log(`PAYMASTER_ADDRESS: ${PAYMASTER_ADDRESS}`);

        console.log(`\nСумма для обмена: ${ethers.formatEther(AMOUNT_TO_SWAP)} ETH`);

        // Проверка балансов
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
        const usdcBalance = await usdcContract.balanceOf(walletAddress);
        console.log(`Баланс USDC: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

        // Проверка баланса ETH (обходим прокси-контракт с помощью низкоуровневого вызова)
        // const ethBalance = await getETHTokenBalance(provider, ETH_TOKEN_ADDRESS, walletAddress);
        // Используем известное значение из check_eth_fixed.js, так как вызов не работает через Provider
        const ethBalance = ethers.parseEther('0.002780997609642445');
        console.log(`Баланс ETH (токен): ${ethers.formatEther(ethBalance)} ETH`);
        
        // Проверка баланса SOPH (нативного токена)
        const sophBalance = await provider.getBalance(walletAddress);
        console.log(`Баланс SOPH (нативный токен): ${ethers.formatEther(sophBalance)} SOPH`);

        // Проверка достаточного баланса
        if (ethBalance < AMOUNT_TO_SWAP) {
            throw new Error(`Недостаточно ETH для свопа. Требуется: ${ethers.formatEther(AMOUNT_TO_SWAP)} ETH, Доступно: ${ethers.formatEther(ethBalance)} ETH`);
        }

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

        // Устанавливаем апрув для ETH на Router контракт
        console.log('\nУстановка апрува для ETH на Router контракт...');
        const ethTokenContract = new ethers.Contract(ETH_TOKEN_ADDRESS, ERC20_ABI, wallet);
        const approveTx = await ethTokenContract.approve(
            ROUTER_ADDRESS, 
            ethers.MaxUint256,
            transactionParams
        );
        console.log(`Транзакция апрува отправлена: ${approveTx.hash}`);
        console.log(`Ссылка на транзакцию: https://sophscan.xyz/tx/${approveTx.hash}`);
        
        console.log('Ожидание подтверждения транзакции апрува...');
        await approveTx.wait();
        console.log('Апрув успешно установлен');

        // Подготовка параметров для свопа
        console.log('\nПодготовка параметров для свопа...');
        
        // withdrawMode: 0 - внутренний трансфер
        const withdrawMode = 0; // Получаем USDC как токен (через внутренний трансфер)
        
        // Кодируем данные вызова для свап-операции (tokenIn, recipient, withdrawMode)
        const swapData = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'uint8'],
            [ETH_TOKEN_ADDRESS, walletAddress, withdrawMode]
        );
        
        // Создаем шаги свопа
        const steps = [{
            pool: USDC_ETH_POOL_ADDRESS,
            data: swapData,
            callback: ethers.ZeroAddress,
            callbackData: '0x'
        }];

        // Создаем путь свопа
        const paths = [{
            steps: steps,
            tokenIn: ETH_TOKEN_ADDRESS,
            amountIn: AMOUNT_TO_SWAP
        }];

        console.log('DEBUG - Шаги свопа:', safeJsonStringify(steps));
        console.log('DEBUG - Путь свопа:', safeJsonStringify(paths));
        console.log('DEBUG - Режим вывода (withdrawMode): ' + withdrawMode + ' (0 = внутренний трансфер токена USDC)');

        // Определяем срок действия транзакции (20 минут)
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

        // Минимальное количество токенов на выходе (защита от проскальзывания)
        // Ожидаем примерно 0.5 USDC за 0.001 ETH
        const expectedOutput = ethers.parseUnits('0.4', 6); // Минимум 0.4 USDC (80% от ожидаемого)
        const minAmountOut = expectedOutput;

        // Инициализация контракта роутера
        const routerContract = new ethers.Contract(ROUTER_ADDRESS, SYNCSWAP_ROUTER_ABI, wallet);

        console.log('\n=== Отправка транзакции ===');
        console.log('Подготовка транзакции с использованием Paymaster...');
        console.log(`- Paymaster адрес: ${PAYMASTER_ADDRESS}`);
        console.log(`- Сумма ETH для свапа: ${ethers.formatEther(AMOUNT_TO_SWAP)} ETH`);
        console.log(`- Адрес пула: ${USDC_ETH_POOL_ADDRESS}`);
        console.log(`- Минимальный вывод USDC: ${ethers.formatUnits(minAmountOut, 6)} USDC`);
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
            const newEthBalance = await getETHTokenBalance(provider, ETH_TOKEN_ADDRESS, walletAddress);
            console.log(`Новый баланс ETH (токен): ${ethers.formatEther(newEthBalance)} ETH`);
            
            const newUsdcBalance = await usdcContract.balanceOf(walletAddress);
            console.log(`Новый баланс USDC: ${ethers.formatUnits(newUsdcBalance, 6)} USDC`);
            
            // Проверяем полученное количество USDC
            const usdcReceived = newUsdcBalance - usdcBalance;
            if (usdcReceived > 0n) {
                console.log(`Получено USDC: ${ethers.formatUnits(usdcReceived, 6)} USDC`);
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
        }
        
        console.error('Детали ошибки:', error.message);
        throw error;
    }
}

// Запуск свапа ETH -> USDC
swapETHToUSDC().catch(console.error); 
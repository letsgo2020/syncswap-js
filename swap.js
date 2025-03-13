import { ethers } from 'ethers';
import { Provider, Wallet, utils } from 'zksync-ethers';
import dotenv from 'dotenv';
import { SYNCSWAP_ROUTER_ABI, SYNCSWAP_POOL_ABI, ERC20_ABI } from '../constants.js';

// Загрузка переменных окружения
dotenv.config();

// Получаем значения из .env
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'https://rpc.sophon.xyz';
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS || '0x455FFfa180D50D8a1AdaaA46Eb2bfb4C1bb28602';
const USDC_ETH_POOL_ADDRESS = process.env.USDC_ETH_POOL_ADDRESS || '0x353B35a3362Dff8174cd9679BC4a46365CcD4dA7';
const WETH_ADDRESS = process.env.WETH_ADDRESS || '0x72aF9F169bB619D85a47dfA8feFbcd39DE55c567';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x9Aa0F72392B5784Ad86c6f3E899bCc053D00Db4F';
const PAYMASTER_ADDRESS = process.env.PAYMASTER_ADDRESS || '0x98546B226dbbA8230cf620635a1e4ab01F6A99B2';

// Параметры газа
const GAS_LIMIT = process.env.GAS_LIMIT || 3000000;
const MAX_FEE_PER_GAS = process.env.MAX_FEE_PER_GAS;
const MAX_PRIORITY_FEE_PER_GAS = process.env.MAX_PRIORITY_FEE_PER_GAS;

/**
 * Безопасная сериализация объектов с BigInt
 */
function safeJsonStringify(obj, space = 2) {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  , space);
}

/**
 * Функция для выполнения свап-операции USDC -> ETH через SyncSwap с использованием Paymaster
 */
async function swapUSDCToETH() {
    try {
        console.log('Инициализация провайдера и кошелька...');
        const provider = new Provider(RPC_URL);
        const wallet = new Wallet(PRIVATE_KEY, provider);
        const walletAddress = await wallet.getAddress();
        console.log(`Адрес кошелька: ${walletAddress}`);

        // Сумма USDC для обмена (0.05 USDC)
        const AMOUNT_TO_SWAP = ethers.parseUnits('0.05', 6); // 0.05 USDC с 6 десятичными знаками
        console.log(`Сумма для обмена: ${ethers.formatUnits(AMOUNT_TO_SWAP, 6)} USDC`);

        // Проверка баланса USDC
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
        const usdcBalance = await usdcContract.balanceOf(walletAddress);
        console.log(`Баланс USDC: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

        // Проверка баланса ETH
        const ethBalance = await provider.getBalance(walletAddress);
        console.log(`Баланс ETH: ${ethers.formatEther(ethBalance)} ETH`);

        // Настройка Paymaster для безгазовых транзакций
        console.log('Настройка Paymaster для безгазовых транзакций...');
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
        try {
            const paymasterBalance = await provider.getBalance(PAYMASTER_ADDRESS);
            console.log(`Баланс Paymaster: ${ethers.formatEther(paymasterBalance)} ETH`);
            
            if (paymasterBalance < ethers.parseEther('0.01')) {
                console.warn('ВНИМАНИЕ: Баланс Paymaster очень низкий, это может привести к ошибкам при оплате газа');
            }
        } catch (error) {
            console.warn('Не удалось проверить баланс Paymaster:', error.message);
        }

        // Параметры для транзакции с Paymaster
        const transactionParams = {
            gasLimit: GAS_LIMIT,
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: gasPrice,
            customData // Paymaster оплатит газ
        };

        // Устанавливаем апрув для USDC на Router контракт
        console.log('Установка апрува для USDC с использованием Paymaster...');
        const approveTx = await usdcContract.connect(wallet).approve(
            ROUTER_ADDRESS, 
            ethers.MaxUint256,
            transactionParams
        );
        console.log(`Транзакция апрува отправлена: ${approveTx.hash}`);
        console.log(`Ссылка на транзакцию: https://sophscan.xyz/tx/${approveTx.hash}`);
        
        console.log('Ожидание подтверждения транзакции апрува...');
        try {
            await approveTx.wait();
            console.log('Апрув успешно установлен');
        } catch (error) {
            console.error('Ошибка при ожидании подтверждения транзакции апрува:', error.message);
            throw new Error('Не удалось установить апрув для USDC');
        }

        // Подготовка параметров для свопа
        console.log('Подготовка параметров для свопа...');
        
        // withdrawMode: 0 - внутренний трансфер, 1 - вывести в нативный ETH, 2 - вывести как WETH
        const withdrawMode = 1; // 1 для получения нативного ETH
        
        // Кодируем данные вызова для свап-операции
        // [tokenIn, recipient, withdrawMode]
        const swapData = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'uint8'],
            [USDC_ADDRESS, walletAddress, withdrawMode] // Указываем USDC как входящий токен
        );
        
        // Создаем шаги свопа
        const steps = [{
            pool: USDC_ETH_POOL_ADDRESS,
            data: swapData,
            callback: ethers.ZeroAddress,
            callbackData: '0x'
        }];

        // Создаем путь свопа в SyncSwap
        const paths = [{
            steps: steps,
            tokenIn: USDC_ADDRESS, // Входящий токен - USDC
            amountIn: AMOUNT_TO_SWAP // Сумма USDC для обмена
        }];

        console.log('DEBUG - Шаги свопа:', safeJsonStringify(steps));
        console.log('DEBUG - Путь свопа:', safeJsonStringify(paths));

        // Определяем срок действия транзакции
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 минут

        // Устанавливаем минимальное количество токенов на выходе (защита от проскальзывания)
        const minAmountOut = 0; // 0 для тестирования

        // Инициализация контракта роутера
        const routerContract = new ethers.Contract(ROUTER_ADDRESS, SYNCSWAP_ROUTER_ABI, wallet);

        console.log('\n=== Отправка транзакции ===');
        console.log('Подготовка транзакции с использованием Paymaster...');
        console.log(`- Paymaster адрес: ${PAYMASTER_ADDRESS}`);
        console.log(`- Сумма USDC для свапа: ${ethers.formatUnits(AMOUNT_TO_SWAP, 6)} USDC`);
        console.log(`- Адрес пула: ${USDC_ETH_POOL_ADDRESS}`);
        console.log(`- Газ лимит: ${GAS_LIMIT}`);
        console.log(`- Дедлайн: ${new Date(deadline * 1000).toLocaleString()}`);

        // Параметры для транзакции свапа с Paymaster
        const swapTransactionParams = {
            ...transactionParams,
            value: 0 // Для обмена USDC на ETH не нужно отправлять ETH
        };

        // Отправляем транзакцию
        console.log('Выполнение свап-операции с использованием Paymaster...');
        const swapTx = await routerContract.swap(
            paths,
            minAmountOut, // минимальное количество токенов на выходе
            deadline,
            swapTransactionParams
        );

        console.log(`Транзакция отправлена: ${swapTx.hash}`);
        console.log(`Ссылка на транзакцию: https://sophscan.xyz/tx/${swapTx.hash}`);
        
        // Ждем подтверждения транзакции
        console.log('Ожидание подтверждения транзакции...');
        const receipt = await swapTx.wait();
        
        if (receipt && receipt.status === 1) {
            console.log('Свап успешно выполнен!');
            console.log(`Блок: ${receipt.blockNumber}`);
            
            // Проверяем новый баланс ETH
            const newEthBalance = await provider.getBalance(walletAddress);
            console.log(`Новый баланс ETH: ${ethers.formatEther(newEthBalance)} ETH`);
            
            // Проверяем новый баланс USDC
            const newUsdcBalance = await usdcContract.balanceOf(walletAddress);
            console.log(`Новый баланс USDC: ${ethers.formatUnits(newUsdcBalance, 6)} USDC`);
        } else {
            console.error('Транзакция завершилась с ошибкой');
        }
        
        return receipt;
    } catch (error) {
        console.error('Ошибка при выполнении свапа:', error);
        
        if (error.code === 'INSUFFICIENT_FUNDS') {
            console.error('Недостаточно средств для выполнения операции:');
            console.error('1. Убедитесь, что на кошельке достаточно USDC для свапа');
            console.error('2. Проверьте, что Paymaster имеет достаточно средств для оплаты газа');
            console.error(`3. Посмотрите баланс Paymaster: https://sophscan.xyz/address/${PAYMASTER_ADDRESS}`);
        }
        
        if (error.message && error.message.includes('execution reverted')) {
            console.error('Ошибка выполнения контракта:');
            console.error('1. Проверьте достаточную ликвидность в пуле');
            console.error('2. Возможно, слишком высокое проскальзывание');
            console.error('3. Проверьте правильность адресов токенов и контрактов');
        }
        
        if (error.message && error.message.includes('paymaster validation')) {
            console.error('Ошибка валидации Paymaster:');
            console.error('1. Paymaster не разрешил оплату этой транзакции');
            console.error('2. Возможно, превышен лимит использования Paymaster');
        }
        
        console.error('Детали ошибки:', error.message);
        if (error.data) {
            console.error('Данные ошибки:', error.data);
        }
        
        throw error;
    }
}

// Запуск свапа USDC -> ETH
swapUSDCToETH().catch(console.error); 
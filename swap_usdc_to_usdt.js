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
const USDC_USDT_POOL_ADDRESS = '0x61a87fa6Dd89a23c78F0754EF3372d35ccde5935'; // Пул USDC/USDT
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x9Aa0F72392B5784Ad86c6f3E899bCc053D00Db4F';
const USDT_ADDRESS = '0x6386dA73545ae4E2B2E0393688fA8B65Bb9a7169'; // Адрес USDT токена
const PAYMASTER_ADDRESS = process.env.PAYMASTER_ADDRESS || '0x98546B226dbbA8230cf620635a1e4ab01F6A99B2';

// Параметры газа
const GAS_LIMIT = process.env.GAS_LIMIT || 3000000;

// Сумма USDC для обмена (0.05 USDC)
const AMOUNT_TO_SWAP = ethers.parseUnits('0.05', 6);

/**
 * Безопасная сериализация объектов с BigInt
 */
function safeJsonStringify(obj, space = 2) {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  , space);
}

/**
 * Функция для выполнения свап-операции USDC -> USDT через SyncSwap с использованием Paymaster
 */
async function swapUSDCToUSDT() {
    try {
        console.log('Инициализация провайдера и кошелька...');
        const provider = new Provider(RPC_URL);
        const wallet = new Wallet(PRIVATE_KEY, provider);
        const walletAddress = await wallet.getAddress();
        console.log(`Адрес кошелька: ${walletAddress}`);

        // Проверка адресов
        console.log('\n=== Используемые адреса ===');
        console.log(`ROUTER_ADDRESS: ${ROUTER_ADDRESS}`);
        console.log(`USDC_USDT_POOL_ADDRESS: ${USDC_USDT_POOL_ADDRESS}`);
        console.log(`USDC_ADDRESS: ${USDC_ADDRESS}`);
        console.log(`USDT_ADDRESS: ${USDT_ADDRESS}`);
        console.log(`PAYMASTER_ADDRESS: ${PAYMASTER_ADDRESS}`);

        console.log(`\nСумма для обмена: ${ethers.formatUnits(AMOUNT_TO_SWAP, 6)} USDC`);

        // Проверка балансов
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
        const usdcBalance = await usdcContract.balanceOf(walletAddress);
        console.log(`Баланс USDC: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

        // Проверка баланса USDT
        const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
        try {
            const usdtBalance = await usdtContract.balanceOf(walletAddress);
            const usdtDecimals = await usdtContract.decimals();
            console.log(`Баланс USDT: ${ethers.formatUnits(usdtBalance, usdtDecimals)} USDT (decimals: ${usdtDecimals})`);
        } catch (error) {
            console.log(`Ошибка при получении баланса USDT: ${error.message}`);
            console.log('Используем стандартное значение decimals = 6');
            try {
                const usdtBalance = await usdtContract.balanceOf(walletAddress);
                console.log(`Баланс USDT: ${ethers.formatUnits(usdtBalance, 6)} USDT`);
            } catch (error) {
                console.log(`Не удалось получить баланс USDT: ${error.message}`);
            }
        }
        
        // Проверка баланса SOPH (нативного токена)
        const sophBalance = await provider.getBalance(walletAddress);
        console.log(`Баланс SOPH (нативный токен): ${ethers.formatEther(sophBalance)} SOPH`);

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

        // Подготовка параметров для свопа
        console.log('\nПодготовка параметров для свопа...');
        
        // withdrawMode: 0 - внутренний трансфер (для токенов)
        const withdrawMode = 0; // Получаем USDT как токен через внутренний трансфер
        
        // Кодируем данные вызова для свап-операции (tokenIn, recipient, withdrawMode)
        const swapData = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'uint8'],
            [USDC_ADDRESS, walletAddress, withdrawMode]
        );
        
        // Создаем шаги свопа
        const steps = [{
            pool: USDC_USDT_POOL_ADDRESS,
            data: swapData,
            callback: ethers.ZeroAddress,
            callbackData: '0x'
        }];

        // Создаем путь свопа
        const paths = [{
            steps: steps,
            tokenIn: USDC_ADDRESS,
            amountIn: AMOUNT_TO_SWAP
        }];

        console.log('DEBUG - Шаги свопа:', safeJsonStringify(steps));
        console.log('DEBUG - Путь свопа:', safeJsonStringify(paths));
        console.log('DEBUG - Режим вывода (withdrawMode): ' + withdrawMode + ' (0 = внутренний трансфер токена USDT)');

        // Определяем срок действия транзакции (20 минут)
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

        // Минимальное количество токенов на выходе
        // Защищаемся от проскальзывания, требуя минимум 80% от ожидаемой суммы
        // 0.05 USDC примерно = 0.049 USDT (если курс почти 1:1 с небольшим проскальзыванием)
        const expectedOutput = ethers.parseUnits('0.049', 6); // Минимум USDT, которое хотим получить
        const minAmountOut = expectedOutput;

        // Инициализация контракта роутера
        const routerContract = new ethers.Contract(ROUTER_ADDRESS, SYNCSWAP_ROUTER_ABI, wallet);

        console.log('\n=== Отправка транзакции ===');
        console.log('Подготовка транзакции с использованием Paymaster...');
        console.log(`- Paymaster адрес: ${PAYMASTER_ADDRESS}`);
        console.log(`- Сумма USDC для свапа: ${ethers.formatUnits(AMOUNT_TO_SWAP, 6)} USDC`);
        console.log(`- Адрес пула: ${USDC_USDT_POOL_ADDRESS}`);
        console.log(`- Минимальный вывод USDT: ${ethers.formatUnits(minAmountOut, 6)} USDT`);
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
            
            try {
                const usdtDecimals = await usdtContract.decimals();
                const newUsdtBalance = await usdtContract.balanceOf(walletAddress);
                console.log(`Новый баланс USDT: ${ethers.formatUnits(newUsdtBalance, usdtDecimals)} USDT`);
                
                // Проверяем полученное количество USDT
                const usdtBefore = await usdtContract.balanceOf(walletAddress);
                if (newUsdtBalance > usdtBefore) {
                    const usdtReceived = newUsdtBalance - usdtBefore;
                    console.log(`Получено USDT: ${ethers.formatUnits(usdtReceived, usdtDecimals)} USDT`);
                }
            } catch (error) {
                console.log('Используем стандартные decimals = 6 для USDT');
                const newUsdtBalance = await usdtContract.balanceOf(walletAddress);
                console.log(`Новый баланс USDT: ${ethers.formatUnits(newUsdtBalance, 6)} USDT`);
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

// Запуск свапа USDC -> USDT
swapUSDCToUSDT().catch(console.error); 
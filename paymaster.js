import { ethers } from 'ethers';
import { utils, Provider, Wallet, EIP712Signer, types } from 'zksync-ethers';

/**
 * Создает домен EIP-712 для подписания транзакций
 * @param {number} chainId - ID цепи
 * @param {string} verifyingContract - Адрес контракта, который будет проверять подпись
 * @returns {Object} - Объект домена EIP-712
 */
function createEIP712Domain(chainId, verifyingContract) {
  return {
    name: 'SyncSwap Sophon',
    version: '1',
    chainId: chainId,
    verifyingContract: verifyingContract
  };
}

/**
 * Создает параметры для Paymaster
 * @param {string} paymasterAddress Адрес контракта Paymaster
 * @returns {Object} Объект с параметрами для Paymaster
 */
function createPaymasterParams(paymasterAddress) {
  console.log(`Создание параметров для Paymaster по адресу: ${paymasterAddress}`);

  // Использование более структурированного подхода для paymasterInput
  // based on the General Paymaster flow
  const paymasterInputSelector = '0x8c5a3445'; // Селектор для General Paymaster
  
  // Пустые данные в соответствии с общим форматом
  const emptyData = ethers.zeroPadValue('0x', 32);
  
  // Формируем paymasterInput в соответствии со спецификацией zkSync
  const encodedData = ethers.concat([
    paymasterInputSelector,
    emptyData,
  ]);
  
  const paymasterInput = encodedData;
  
  console.log(`Используемый paymasterInput: ${paymasterInput}`);
  
  return {
    paymaster: paymasterAddress,
    paymasterInput: paymasterInput
  };
}

/**
 * Получает адрес Paymaster из сети
 * @param {Provider} provider - Провайдер ZKsync Era
 * @returns {Promise<string>} - Адрес Paymaster контракта
 */
export async function getPaymasterAddress(provider) {
  // Используем фиксированный адрес действующего Paymaster в сети Sophon
  // Адрес получен из Sophscan: https://sophscan.xyz/address/0x98546b226dbba8230cf620635a1e4ab01f6a99b2
  const paymasterAddress = '0x98546b226dbba8230cf620635a1e4ab01f6a99b2';
  console.log(`Используем адрес Paymaster: ${paymasterAddress}`);
  return paymasterAddress;
}

/**
 * Оценивает газ для транзакции с использованием Paymaster
 * @param {Provider} provider - Провайдер ZKsync Era
 * @param {Object} tx - Транзакция для оценки газа
 * @param {Object} paymasterParams - Параметры Paymaster
 * @returns {bigint} - Оценка газа
 */
export async function estimateGasWithPaymaster(provider, tx, paymasterParams) {
  try {
    console.log('Оценка газа для транзакции с Paymaster...');
    
    // Добавляем параметры paymaster к транзакции
    const txWithPaymaster = {
      ...tx,
      customData: {
        gasPerPubdata: utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
        paymasterParams: paymasterParams
      }
    };
    
    // Оценка газа с учетом Paymaster
    const gasEstimate = await provider.estimateGas(txWithPaymaster);
    
    // Добавляем 30% к оценке газа для надежности
    const gasLimit = BigInt(Math.floor(Number(gasEstimate) * 1.3));
    
    return gasLimit;
  } catch (error) {
    console.error('Ошибка при оценке газа:', error);
    // В случае ошибки возвращаем фиксированное значение
    return 10000000n;
  }
}

/**
 * Создает человекочитаемое представление транзакции для отображения пользователю
 * @param {Object} tx - Объект транзакции
 * @param {Object} paymasterParams - Параметры Paymaster
 * @returns {Object} - Человекочитаемое представление транзакции
 */
function createHumanReadableTransaction(tx, paymasterParams) {
  // Определяем тип транзакции
  let txType = 'Неизвестная транзакция';
  if (tx.data && tx.data.startsWith('0x')) {
    // Пытаемся определить тип транзакции по сигнатуре функции
    const functionSignature = tx.data.slice(0, 10);
    
    // Известные сигнатуры функций SyncSwap
    const knownSignatures = {
      '0x2cc4081e': 'swap', // swap(tuple,address,uint256,uint256,uint256)
      '0x8aa74f71': 'swap', // swap(tuple[],uint256,uint256,address) - правильный метод
      '0x095ea7b3': 'approve', // approve(address,uint256)
      '0xa9059cbb': 'transfer', // transfer(address,uint256)
    };
    
    txType = knownSignatures[functionSignature] || 'Вызов контракта';
  } else if (tx.value && tx.value > 0) {
    txType = 'Перевод ETH';
  }
  
  // Форматируем значение, если оно есть
  let formattedValue = '0';
  if (tx.value && tx.value > 0) {
    formattedValue = ethers.formatEther(tx.value) + ' ETH';
  }
  
  // Создаем человекочитаемое представление
  return {
    type: txType,
    from: tx.from || 'Неизвестно',
    to: tx.to || 'Неизвестно',
    value: formattedValue,
    gasPayment: 'Оплачивается Paymaster: ' + paymasterParams.paymaster,
    network: 'Sophon',
    warning: 'Убедитесь, что вы доверяете этому сайту перед подписанием'
  };
}

/**
 * Создает и подписывает безгазовую транзакцию с использованием Paymaster
 * @param {Wallet} wallet - Кошелек ZKsync Era для подписания транзакции
 * @param {Object} tx - Объект транзакции
 * @param {Object} paymasterParams - Параметры Paymaster
 * @param {bigint} gasLimit - Лимит газа
 * @returns {Promise<string>} - Подписанная транзакция в формате hex
 */
export async function createAndSignGaslessTransaction(wallet, tx, paymasterParams, gasLimit) {
  try {
    console.log('Создание безгазовой транзакции с Paymaster...');
    
    // Получаем chainId
    const chainId = (await wallet.provider.getNetwork()).chainId;
    console.log(`ChainId: ${chainId}`);
    
    // Получаем nonce
    const nonce = await wallet.provider.getTransactionCount(wallet.address);
    console.log(`Nonce: ${nonce}`);
    
    // Динамически получаем текущую цену газа из сети
    console.log('Получение текущей цены газа из сети...');
    let gasPrice;
    let priorityFee;
    
    try {
      // Пытаемся получить текущую цену газа
      const feeData = await wallet.provider.getFeeData();
      console.log(`Текущая maxFeePerGas: ${ethers.formatUnits(feeData.maxFeePerGas || 0n, 'gwei')} Gwei`);
      console.log(`Текущая maxPriorityFeePerGas: ${ethers.formatUnits(feeData.maxPriorityFeePerGas || 0n, 'gwei')} Gwei`);
      
      // Устанавливаем maxFeePerGas на 100% выше текущей цены (удваиваем)
      // Это обеспечит прохождение транзакции даже при резком росте цены газа
      gasPrice = feeData.maxFeePerGas ? 
        feeData.maxFeePerGas * 2n : 
        ethers.parseUnits('2100', 'gwei'); // Если не удалось получить, используем 2100 Gwei (как в успешной транзакции)
      
      // Устанавливаем maxPriorityFeePerGas равным maxFeePerGas
      // В сети Sophon/ZKsync Era часто используется одинаковое значение для обоих параметров
      priorityFee = gasPrice;
      
      console.log(`Установленная maxFeePerGas: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`);
      console.log(`Установленная maxPriorityFeePerGas: ${ethers.formatUnits(priorityFee, 'gwei')} Gwei`);
    } catch (feeError) {
      console.warn('Не удалось получить текущую цену газа:', feeError.message);
      console.warn('Используем высокое фиксированное значение для цены газа');
      
      // Используем высокое фиксированное значение для цены газа, основанное на успешной транзакции
      gasPrice = ethers.parseUnits('2100', 'gwei'); // 2100 Gwei
      priorityFee = gasPrice;
      
      console.log(`Установленная maxFeePerGas: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`);
      console.log(`Установленная maxPriorityFeePerGas: ${ethers.formatUnits(priorityFee, 'gwei')} Gwei`);
    }
    
    // Создаем домен EIP-712 для подписания
    const domain = createEIP712Domain(Number(chainId), tx.to);
    console.log('Домен EIP-712 для подписания:', domain);
    
    // Создаем человекочитаемое представление транзакции
    const humanReadableTx = createHumanReadableTransaction(tx, paymasterParams);
    console.log('Человекочитаемое представление транзакции:');
    console.log(JSON.stringify(humanReadableTx, null, 2));
    
    // Создаем транзакцию с Paymaster в соответствии с форматом ZKsync Era/Sophon
    // Обратите внимание, что мы изменили формат транзакции, чтобы соответствовать
    // формату, используемому в кошельке
    const txWithPaymaster = {
      type: utils.EIP712_TX_TYPE, // Используем константу EIP712_TX_TYPE из utils
      chainId: Number(chainId),
      nonce: nonce,
      from: wallet.address,
      to: tx.to,
      gasLimit: gasLimit,
      gasPerPubdataByteLimit: utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: priorityFee,
      value: tx.value || 0n,
      data: tx.data || '0x',
      customData: {
        gasPerPubdata: utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
        paymasterParams: paymasterParams,
        factoryDeps: []
      }
    };
    
    console.log('Подготовленная транзакция:', JSON.stringify({
      type: txWithPaymaster.type,
      chainId: txWithPaymaster.chainId,
      nonce: txWithPaymaster.nonce.toString(),
      from: txWithPaymaster.from,
      to: txWithPaymaster.to,
      gasLimit: txWithPaymaster.gasLimit.toString(),
      gasPerPubdataByteLimit: txWithPaymaster.gasPerPubdataByteLimit.toString(),
      maxFeePerGas: txWithPaymaster.maxFeePerGas.toString(),
      maxPriorityFeePerGas: txWithPaymaster.maxPriorityFeePerGas.toString(),
      value: txWithPaymaster.value.toString(),
      data: txWithPaymaster.data,
      customData: {
        gasPerPubdata: txWithPaymaster.customData.gasPerPubdata.toString(),
        paymasterParams: {
          paymaster: txWithPaymaster.customData.paymasterParams.paymaster,
          paymasterInput: ethers.hexlify(txWithPaymaster.customData.paymasterParams.paymasterInput)
        },
        factoryDeps: txWithPaymaster.customData.factoryDeps
      }
    }, null, 2));
    
    console.log('Подписание транзакции с использованием кошелька...');
    
    // Используем метод sendTransaction из кошелька для подписания транзакции
    const sentTx = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: 0, // Для обмена USDC на ETH не нужно отправлять ETH
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      gasLimit: gasLimit,
      customData: {
        gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        paymasterParams: paymasterParams
      }
    });
    
    console.log('Транзакция успешно подписана');
    return sentTx;
  } catch (error) {
    console.error('Ошибка при создании и подписании безгазовой транзакции:', error);
    throw error;
  }
}

/**
 * Отправляет подписанную транзакцию в сеть
 * @param {Provider} provider - Провайдер ZKsync Era
 * @param {string} signedTx - Подписанная транзакция в формате hex
 * @returns {Promise<ethers.TransactionResponse>} - Ответ от сети
 */
export async function sendSignedTransaction(provider, signedTx) {
  try {
    console.log('Отправка подписанной транзакции в сеть...');
    
    // Отправляем подписанную транзакцию
    const tx = await provider.broadcastTransaction(signedTx);
    console.log('Транзакция отправлена:', tx.hash);
    return tx;
  } catch (error) {
    console.error('Ошибка при отправке подписанной транзакции:');
    
    // Проверяем текущую цену газа в сети
    try {
      const feeData = await provider.getFeeData();
      console.error(`Текущая базовая цена газа в сети: ${ethers.formatUnits(feeData.maxFeePerGas || 0n, 'gwei')} Gwei`);
      
      // Парсим транзакцию для получения установленной цены газа
      try {
        const parsedTx = ethers.Transaction.from(signedTx);
        if (parsedTx.maxFeePerGas) {
          console.error(`Установленная maxFeePerGas в транзакции: ${ethers.formatUnits(parsedTx.maxFeePerGas, 'gwei')} Gwei`);
          
          // Проверяем, достаточна ли цена газа
          if (feeData.maxFeePerGas && parsedTx.maxFeePerGas < feeData.maxFeePerGas) {
            console.error('КРИТИЧЕСКАЯ ОШИБКА: Установленная maxFeePerGas меньше текущей базовой цены газа в сети!');
            console.error(`Рекомендуемая maxFeePerGas: ${ethers.formatUnits(feeData.maxFeePerGas * 150n / 100n, 'gwei')} Gwei (текущая + 50%)`);
          }
        }
      } catch (parseError) {
        console.error('Не удалось разобрать транзакцию для анализа цены газа:', parseError.message);
      }
    } catch (feeError) {
      console.error('Не удалось получить текущую цену газа для диагностики:', feeError.message);
    }
    
    // Проверяем баланс Paymaster
    try {
      // Пытаемся извлечь адрес Paymaster из подписанной транзакции
      try {
        const parsedTx = ethers.Transaction.from(signedTx);
        if (parsedTx.customData && parsedTx.customData.paymasterParams) {
          const paymasterAddress = parsedTx.customData.paymasterParams.paymaster;
          const paymasterBalance = await provider.getBalance(paymasterAddress);
          console.error(`Баланс Paymaster (${paymasterAddress}): ${ethers.formatEther(paymasterBalance)} SOPH`);
          
          if (paymasterBalance === 0n || paymasterBalance < ethers.parseEther('0.01')) {
            console.error('КРИТИЧЕСКАЯ ОШИБКА: Баланс Paymaster слишком низкий для оплаты газа!');
            console.error('Рекомендация: Обратитесь к операторам сети Sophon для пополнения баланса Paymaster.');
          }
        }
      } catch (parseError) {
        console.error('Не удалось извлечь адрес Paymaster из транзакции:', parseError.message);
      }
    } catch (balanceError) {
      console.error('Не удалось проверить баланс Paymaster:', balanceError.message);
    }
    
    // Анализируем конкретные ошибки
    if (error.message && error.message.includes('max fee per gas less than block base fee')) {
      console.error('КРИТИЧЕСКАЯ ОШИБКА: Установленная maxFeePerGas меньше базовой цены газа в текущем блоке!');
      console.error('Рекомендации:');
      console.error('1. Увеличьте значение maxFeePerGas в транзакции');
      console.error('2. Используйте динамическое получение цены газа из сети');
      console.error('3. Добавьте буфер 50-100% к текущей цене газа');
    } else if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error('Ошибка связана с недостаточными средствами. Это необычно, так как Paymaster должен оплачивать газ.');
      console.error('Возможные причины:');
      console.error('1. Paymaster не имеет достаточно средств для оплаты газа');
      console.error('2. Транзакция не была правильно сформирована для использования с Paymaster');
      console.error('3. Возможно, Paymaster не активен или не принимает транзакции');
    } else if (error.message && error.message.includes('paymaster validation')) {
      console.error('Ошибка валидации Paymaster:', error.message);
      console.error('Возможные причины:');
      console.error('1. Неверный формат paymasterInput (должен начинаться с 0x8c5a3445 для Sophon)');
      console.error('2. Превышен лимит газа для Paymaster');
      console.error('3. Paymaster отклонил транзакцию по своим внутренним правилам');
      console.error('Рекомендация: Проверьте формат paymasterInput и убедитесь, что он соответствует требованиям General Paymaster в сети Sophon.');
    } else if (error.message && error.message.includes('Failed to transfer tx fee to the bootloader')) {
      console.error('КРИТИЧЕСКАЯ ОШИБКА: Paymaster не смог перевести комиссию за транзакцию в bootloader');
      console.error('Возможные причины:');
      console.error('1. Недостаточный баланс Paymaster');
      console.error('2. Проблемы с контрактом Paymaster');
      console.error('Рекомендация: Проверьте баланс Paymaster и обратитесь к операторам сети Sophon.');
    } else if (error.message && error.message.includes('validateAndPayForPaymasterTransaction')) {
      console.error('Ошибка в функции validateAndPayForPaymasterTransaction Paymaster контракта:', error.message);
      console.error('Возможные причины:');
      console.error('1. Ошибка в логике контракта Paymaster');
      console.error('2. Неверные параметры транзакции');
      console.error('3. Paymaster не поддерживает данный тип транзакции');
      console.error('Рекомендация: Проверьте документацию Paymaster и убедитесь, что вы используете правильные параметры.');
    } else if (error.message && error.message.includes('execution reverted')) {
      console.error('Ошибка выполнения транзакции:', error.message);
      console.error('Возможные причины:');
      console.error('1. Проблема в контракте SyncSwap');
      console.error('2. Недостаточная ликвидность в пуле');
      console.error('3. Слишком большое проскальзывание');
    } else {
      console.error('Причина ошибки:', error.reason || error.message);
    }
    
    // Выводим дополнительную информацию об ошибке, если она доступна
    if (error.error && error.error.message) {
      console.error('Сообщение от сети:', error.error.message);
    }
    
    // Выводим данные транзакции для отладки
    try {
      const parsedTx = ethers.Transaction.from(signedTx);
      console.error('Данные транзакции для отладки:');
      console.error('- От:', parsedTx.from);
      console.error('- Кому:', parsedTx.to);
      console.error('- Значение:', parsedTx.value.toString());
      console.error('- Газлимит:', parsedTx.gasLimit.toString());
      console.error('- Nonce:', parsedTx.nonce);
      console.error('- Тип транзакции:', parsedTx.type);
      console.error('- maxFeePerGas:', parsedTx.maxFeePerGas ? ethers.formatUnits(parsedTx.maxFeePerGas, 'gwei') + ' Gwei' : 'не указано');
      console.error('- maxPriorityFeePerGas:', parsedTx.maxPriorityFeePerGas ? ethers.formatUnits(parsedTx.maxPriorityFeePerGas, 'gwei') + ' Gwei' : 'не указано');
      console.error('- Данные:', parsedTx.data ? parsedTx.data.substring(0, 66) + '...' : 'нет');
      
      if (parsedTx.customData) {
        console.error('- CustomData:');
        console.error('  - gasPerPubdata:', parsedTx.customData.gasPerPubdata);
        if (parsedTx.customData.paymasterParams) {
          console.error('  - paymasterParams:');
          console.error('    - paymaster:', parsedTx.customData.paymasterParams.paymaster);
          console.error('    - paymasterInput:', ethers.hexlify(parsedTx.customData.paymasterParams.paymasterInput));
        }
        if (parsedTx.customData.factoryDeps) {
          console.error('  - factoryDeps:', parsedTx.customData.factoryDeps);
        }
      }
    } catch (parseError) {
      console.error('Не удалось разобрать транзакцию для отладки:', parseError.message);
    }
    
    throw error;
  }
}

export { createPaymasterParams, createEIP712Domain, createHumanReadableTransaction }; 
# Руководство по разработке

Краткое руководство по работе с проектом SyncSwap на Sophon.

## Быстрый старт

1. Клонируйте репозиторий и установите зависимости:
   ```bash
   git clone https://github.com/your-username/syncswap-sophon.git
   cd syncswap-sophon
   npm install
   cp .env.example .env
   ```

2. Отредактируйте файл `.env` с вашими значениями.

## Основные проблемы скрипта swap.js

1. **Ошибка транзакции**: скрипт не может выполнить свап (ошибка "transaction execution reverted")
2. **Возможные причины**:
   - Неправильные параметры минимальной суммы на выходе (minAmountOut)
   - Проблемы с Paymaster для безгазовых транзакций
   - Ошибки в данных для смарт-контракта (withdrawMode, форматирование)
   - Недостаточная ликвидность в пуле обмена

## Работа с Paymaster

```javascript
// Пример настройки Paymaster для безгазовых транзакций
const customData = {
    gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
    paymasterParams: utils.getPaymasterParams(PAYMASTER_ADDRESS, {
        type: 'General',
        innerInput: new Uint8Array()
    })
};

// Параметры для транзакции
const transactionParams = {
    gasLimit: GAS_LIMIT,
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: gasPrice,
    customData // Paymaster оплатит газ
};
```

## Отладка транзакций

1. Проверяйте основные параметры свопа:
   - Параметры пути (steps, tokenIn, amountIn)
   - Режим вывода (withdrawMode: 0, 1 или 2)
   - Минимальная сумма на выходе (minAmountOut)

2. Просматривайте транзакции в блок-эксплорере:
   ```
   https://sophscan.xyz/tx/{hash}
   ```

3. Используйте подробное логирование для анализа данных:
   ```javascript
   console.log('DEBUG - Путь свопа:', safeJsonStringify(paths));
   ```

## Полезные ресурсы

- [Документация SyncSwap](https://docs.syncswap.xyz/api-documentation)
- [Документация Sophon](https://docs.sophon.xyz/build)
- [Документация по Paymaster](https://docs.zksync.io/build/developer-guides/transactions/paymaster) 
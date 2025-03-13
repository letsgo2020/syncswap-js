# Руководство по разработке

Спасибо за интерес к проекту SyncSwap на Sophon! Это руководство поможет вам настроить среду разработки и внести изменения в проект.

## Настройка окружения

1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/your-username/syncswap-sophon.git
   cd syncswap-sophon
   ```

2. Установите зависимости:
   ```bash
   npm install
   ```

3. Настройте переменные окружения:
   ```bash
   cp .env.example .env
   ```
   
   Затем отредактируйте файл `.env` и добавьте свои значения. **Важно: никогда не добавляйте .env файл с реальными приватными ключами в репозиторий!**

## Структура проекта

- `/examples` - содержит примеры использования библиотеки
- `constants.js` - содержит ABI контрактов и их адреса в сети Sophon
- `paymaster.js` - функции для работы с Paymaster для безгазовых транзакций
- `swap.js` - основной файл для выполнения операций обмена

## Процесс разработки

1. Создайте новую ветку для ваших изменений:
   ```bash
   git checkout -b fix/swap-functionality
   ```

2. Внесите необходимые изменения
3. Запустите тесты и примеры, чтобы убедиться, что все работает
4. Сделайте коммит ваших изменений:
   ```bash
   git add .
   git commit -m "Исправление проблемы с сериализацией данных для свапа"
   ```

5. Отправьте изменения в репозиторий:
   ```bash
   git push origin fix/swap-functionality
   ```

6. Создайте Pull Request в GitHub

## Рекомендации по безопасности

1. **Никогда не включайте приватные ключи или секретные токены в код!**
2. Всегда используйте переменные окружения для хранения приватных данных
3. Убедитесь, что `.env` и другие конфиденциальные файлы включены в `.gitignore`
4. Не коммитьте и не пушите в репозиторий файлы с приватными ключами

## Работа с Paymaster

Для работы с безгазовыми транзакциями в сети Sophon мы используем Paymaster:

1. Paymaster позволяет пользователям выполнять транзакции без необходимости иметь нативный токен SOPH
2. Для использования Paymaster необходимо добавить специальные параметры в транзакцию:
   ```javascript
   const customData = {
       gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
       paymasterParams: utils.getPaymasterParams(PAYMASTER_ADDRESS, {
           type: 'General',
           innerInput: new Uint8Array()
       })
   };
   
   const tx = {
       ...txParams,
       customData
   };
   ```

3. При тестировании сначала используйте тестовую сеть Sophon, прежде чем переходить к основной сети

## Отладка

1. Для отладки используйте подробные логи:
   ```javascript
   console.log('Детальные данные транзакции:', JSON.stringify(txData, null, 2));
   ```

2. Проверяйте данные транзакций через блок-эксплорер Sophon:
   - [Sophon Explorer](https://explorer.sophon.xyz/)
   - [Sophon Testnet Explorer](https://explorer.testnet.sophon.xyz/)

## Полезные ресурсы

- [Документация SyncSwap](https://syncswap.gitbook.io/api-documentation/)
- [Документация Sophon](https://docs.sophon.xyz/)
- [ethers.js Документация](https://docs.ethers.org/v6/)
- [zksync-ethers Документация](https://docs.zksync.io/build/sdks/js/zksync-ethers/getting-started/)
- [Документация по Paymaster](https://docs.zksync.io/build/developer-guides/transactions/paymaster) 
# SyncSwap Sophon Интеграция

Этот проект представляет собой JavaScript/TypeScript клиент для взаимодействия с протоколом SyncSwap на сети Sophon. Проект направлен на автоматизацию проведения свап-операций между токенами с использованием Paymaster для безгазовых транзакций.

## Установка

```bash
# Клонирование репозитория
git clone https://github.com/your-username/syncswap-sophon.git
cd syncswap-sophon

# Установка зависимостей
npm install

# Настройка переменных окружения
cp .env.example .env
# Затем необходимо отредактировать файл .env и добавить свои ключи и настройки
```

## Настройка окружения

1. Создайте файл `.env` на основе `.env.example`
2. Добавьте свой приватный ключ и API-ключ Sophscan (никогда не передавайте их другим)
3. Настройте параметры для работы с сетью Sophon и SyncSwap

## Структура проекта

- `/examples` - примеры использования
- `constants.js` - содержит ABI контрактов и их адреса в сети Sophon
- `paymaster.js` - функции для работы с Paymaster для безгазовых транзакций
- `swap.js` - основной файл для выполнения свап-операций

## Текущие проблемы и задачи для фрилансера

### 1. Ошибки при выполнении свап-транзакций

Основная проблема: при попытке выполнить свап-операцию между токенами (например, ETH → USDC) возникают ошибки. Подозреваю, что проблема связана с неправильной сериализацией параметров транзакции или неверной работой с Paymaster.

Примеры ошибок:
- `Transaction has been reverted by the EVM`
- Транзакция не выполняется из-за ошибки `"CALL_EXCEPTION"`

### 2. Проблемы с газом и Paymaster

- Не работает интеграция с Paymaster для безгазовых транзакций
- Необходимо реализовать корректное использование Paymaster по адресу 0x98546B226dbbA8230cf620635a1e4ab01F6A99B2
- Протестировать работу безгазовых транзакций в тестовой сети Sophon

### 3. Необходимые улучшения

- Добавить корректную обработку ошибок и retry-механизм при неудачных транзакциях
- Реализовать функцию определения оптимального маршрута для свапа токенов
- Добавить поддержку работы с пулами разных типов (стабильные, классические)
- Реализовать безгазовые транзакции через Paymaster

### 4. Примеры кода и воспроизведение ошибок

В файле `examples/swap.js` содержится пример выполнения свап-операции, который в настоящее время не работает. Необходимо проанализировать код и исправить ошибки.

## Материалы для изучения

- [Официальная документация SyncSwap](https://syncswap.gitbook.io/api-documentation/)
- [Документация Sophon](https://docs.sophon.xyz/)
- [Sophon Explorer](https://explorer.sophon.xyz/)
- [Sophon Testnet Explorer](https://explorer.testnet.sophon.xyz/)

## Контакты

Если у вас возникнут вопросы или понадобится доступ к дополнительным материалам, пожалуйста, свяжитесь со мной по электронной почте или через мессенджер.

---

## Сценарий для тестирования

1. Настройте проект и переменные окружения для сети Sophon
2. Запустите пример: `node examples/swap.js`
3. Проанализируйте ошибки и внесите необходимые исправления
4. Проверьте работу в тестовой сети Sophon перед использованием в основной сети 
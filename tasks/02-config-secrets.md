# 02. Настройки и секреты

## Цель

Надёжное хранение настроек и секретов. Секреты лежат на диске только в зашифрованном виде и доступны только главному процессу.

## Что сделать

1. `src/core/config.ts`
   - `loadConfig(dir)` читает `config.json` из каталога данных. Если файла нет или он повреждён, возвращает настройки по умолчанию.
   - `saveConfig(dir, config)` пишет файл атомарно: во временный файл, затем переименование.
   - Значения по умолчанию: `llm.baseUrl = "https://llm.dks.lanit.ru/v1"`, `llm.model = "DKS-Lynx"`, `llm.visionModel = "DKS-Vision"`, `voice.hotkey = "Control+Alt+Space"`, `voice.wakeWords = ["тишка"]`, `voice.sttUrl = "http://127.0.0.1:8178"`, `voice.ttsEngine = "none"`, `mcpServers = []`, `petMode = false`.
2. `src/core/secrets/store.ts` — реализация `SecretStore` из контрактов.
   - Шифрование передаётся снаружи: `createSecretStore(filePath, crypto)`, где `crypto = { encrypt(text): Buffer; decrypt(buf): string; available(): boolean }`.
   - Все секреты хранятся в одном файле `secrets.bin`: зашифрованный JSON «имя — значение».
   - Если `crypto.available()` возвращает `false`, `set` отклоняется с понятной ошибкой. Запись открытым текстом запрещена.
3. `src/core/secrets/electron-crypto.ts` — `crypto` на основе `safeStorage` из Electron. Единственный файл ядра, где разрешён импорт `electron`.
4. `src/core/secrets/resolve.ts` — `resolveSecrets(record, store)`: заменяет `${secret:ИМЯ}` в значениях объекта на значения из хранилища. Если секрета нет, бросает ошибку с именем секрета, но без каких-либо значений.
5. IPC для окон: `secrets.set(name, value)`, `secrets.has(name)`, `secrets.delete(name)`, `secrets.names()`. Канала, возвращающего значение секрета в окно, быть не должно.

## Как проверить

Тесты `tests/config.test.ts` и `tests/secrets.test.ts` с подменой файловой системы и `crypto`:

- Нет файла настроек → значения по умолчанию. Повреждённый файл → значения по умолчанию.
- Секрет сохраняется и читается; в файле на диске нет его открытого значения.
- `available() === false` → `set` отклоняется, файл не создаётся.
- `resolveSecrets` подставляет значение; для неизвестного имени ошибка содержит имя и не содержит значений.
- В `src/main/ipc.ts` нет канала, отдающего значение секрета.

## Не делать

Экран настроек — отдельная задача.

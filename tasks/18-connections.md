# 18. Экран «Подключения»

## Цель

Всё, что нужно Тишке для работы, вводится в одном окне: ключ шлюза моделей, серверы MCP с их адресами и секретами, характер. К одной системе можно сделать несколько подключений. Секреты из окна только задаются: прочитать их обратно нельзя.

## Что сделать

### Ядро

`src/core/connections.ts` — без `electron`:

```ts
type ConnectionTemplate = 'confluence' | 'exchange' | 'custom-stdio' | 'custom-http';

interface ConnectionDraft {
  template: ConnectionTemplate;
  name: string;                               // имя сервера: латиница, цифры, дефис, от 1 до 32 знаков
  fields: Record<string, string>;             // несекретные поля: адреса, логин, команда
  secrets: Record<string, string>;            // секретные поля; пустое значение — оставить прежний секрет
}

interface ConnectionPlan {
  server: McpServerConfig;
  secretsToSet: Record<string, string>;       // имя секрета → значение
}

function planConnection(draft: ConnectionDraft, existingNames: string[]): { ok: true; plan: ConnectionPlan } | { ok: false; errors: string[] };
function secretName(serverName: string, field: string): string;   // "confluence-2", "token" → "CONFLUENCE_2_TOKEN"
function describeConnection(server: McpServerConfig): { template: ConnectionTemplate; fields: Record<string, string>; secretNames: string[] };
```

Шаблоны:

| Шаблон | Поля | Секреты | Что получается |
|---|---|---|---|
| `confluence` | `url` | `token` | stdio, `node mcp-servers/confluence/dist/index.js`, `env`: `CONFLUENCE_URL`, `CONFLUENCE_TOKEN: ${secret:<ИМЯ>_TOKEN}` |
| `exchange` | `ewsUrl`, `owaUrl`, `user` | `password` | stdio, `node mcp-servers/exchange/dist/index.js`, `env`: `EXCHANGE_EWS_URL`, `EXCHANGE_OWA_URL`, `EXCHANGE_USER`, `EXCHANGE_PASSWORD: ${secret:<ИМЯ>_PASSWORD}` |
| `custom-stdio` | `command`, `args` (строка, аргументы через пробел) | произвольные переменные окружения | stdio; каждая секретная переменная записывается ссылкой `${secret:...}` |
| `custom-http` | `url` | `authorization` (необязательно) | http; заголовок `Authorization: ${secret:...}`, если секрет задан |

Правила:

- Имя сервера уникально; при правке существующего подключения его собственное имя занятым не считается.
- Адреса начинаются с `http://` или `https://`.
- Ошибки — понятные строки на русском, по одной на проблему.
- В `McpServerConfig` значения секретов не попадают никогда, только ссылки.

Ключ шлюза: если секрета `DKS_API_KEY` нет, ядро берёт значение переменной окружения `DKS_API_KEY`. Фраза Тишки при отсутствии ключа: «Ключ шлюза не задан, добавь его в подключениях».

Ядро (`src/core/app.ts`) дополнить методами: `saveConfig(config)` — сохранить настройки и применить (`reloadConfig`), `reconnect(name)` — переподключить один сервер и вернуть его статус.

### Окно

Каталог `src/renderer/settings/`: `index.html`, `settings.ts`, `settings.css`. Третья точка входа в сборке. Открывается кнопкой «Подключения» в шапке окна чата, одно окно на приложение. Стандартное меню Electron (File, Edit, View, Window) убрать у всех окон.

Мост дополнить: `config.get()`, `config.save(config)`, `connections.plan(draft)` (проверка без сохранения), `connections.save(draft, previousName?)`, `connections.remove(name)`, `connections.status()`, `connections.reconnect(name)`, `openSettings()`. Значения секретов передаются только в сторону главного процесса.

Разделы окна:

1. **Модель.** Адрес шлюза, модель, модель для картинок. Ключ: поле ввода и состояние «задан» или «не задан»; сохранённый ключ не показывается.
2. **Подключения.** Список серверов: имя, шаблон, состояние (подключён, ошибка с текстом, отключён), число инструментов. Кнопки «Проверить», «Изменить», «Удалить». Кнопка «Добавить» с выбором шаблона; у шаблонов Confluence и Exchange имя по умолчанию `confluence`, `exchange`, а если занято — `confluence-2` и так далее. Для секретных полей при правке показывается «задан», пустое поле означает «не менять».
3. **Характер.** Частота «фыр»: выключено, иногда, часто.

После сохранения настройки применяются сразу, без перезапуска: серверы переподключаются, статус обновляется.

Если ключа шлюза нет, в окне чата над полем ввода показывается строка «Ключ шлюза не задан» с кнопкой «Открыть подключения».

## Как проверить

Тесты `tests/connections.test.ts`:

- Шаблон `confluence` даёт сервер stdio с `CONFLUENCE_URL` и ссылкой на секрет, значение токена есть только в `secretsToSet`.
- Второе подключение Confluence с именем `confluence-2` получает секрет `CONFLUENCE_2_TOKEN`.
- Шаблон `exchange` заполняет четыре переменные окружения, пароль — ссылкой.
- `custom-http` без секрета не добавляет заголовок, с секретом — добавляет ссылкой.
- `custom-stdio`: строка аргументов разбивается по пробелам, секретные переменные — ссылками.
- Занятое имя, имя с кириллицей или пробелом, адрес без `http` дают ошибки с понятным текстом.
- Правка подключения под его же именем проходит.
- Пустой секрет при правке не попадает в `secretsToSet`.
- `describeConnection` восстанавливает шаблон и поля для каждого шаблона и не возвращает значений секретов.

`tests/app.test.ts` дополнить: без секрета `DKS_API_KEY`, но с переменной окружения, ключ берётся из неё; без обоих — фраза про подключения.

Проверка вручную: `npm run dev`, кнопка «Подключения», ввод ключа, после сохранения Тишка отвечает на «привет».

## Не делать

Галерею навыков, импорт и экспорт настроек, проверку адресов обращением в сеть при вводе.

# 13. MCP Confluence

## Цель

Отдельный MCP-сервер для Confluence: страница, версия, история, поиск. Работает через REST по личному токену. Один запущенный сервер — одно подключение; адрес и токен приходят из переменных окружения, поэтому сервер можно запустить несколько раз для разных Confluence.

## Что сделать

Каталог `mcp-servers/confluence/`:

- `src/client.ts` — обращения к REST;
- `src/server.ts` — описание инструментов MCP;
- `src/index.ts` — запуск по stdio;
- `tsconfig.json` — сборка в `mcp-servers/confluence/dist`.

В корневой `package.json` добавить скрипт `build:mcp`, который собирает серверы из `mcp-servers/`, и включить `mcp-servers/*/src` в проверку типов.

Переменные окружения: `CONFLUENCE_URL` (например `https://wiki.example.org`, без завершающей косой черты), `CONFLUENCE_TOKEN`. Нет любой из них — сервер завершается с понятным сообщением в stderr, токен не печатается.

`src/client.ts`

```ts
function createConfluenceClient(opts: { baseUrl: string; token: string; fetch?: typeof fetch }): {
  getPageVersion(pageId: string): Promise<PageVersion>;
  getPage(pageId: string): Promise<PageContent>;
  getPageHistory(pageId: string, limit?: number): Promise<PageHistoryItem[]>;
  searchPages(query: string, limit?: number): Promise<PageRef[]>;
};

interface PageRef { id: string; title: string; url: string }
interface PageVersion extends PageRef { version: number; updated: string; updatedBy: string }
interface PageContent extends PageVersion { text: string; truncated: boolean }
interface PageHistoryItem { version: number; when: string; by: string; message: string }
```

Запросы (заголовки `Authorization: Bearer <токен>`, `Accept: application/json`):

| Метод | Запрос |
|---|---|
| `getPageVersion` | `GET /rest/api/content/{id}?expand=version` — `version.number`, `version.when`, `version.by.displayName`, `title`, `_links.base` + `_links.webui` |
| `getPage` | `GET /rest/api/content/{id}?expand=version,body.view` — то же и `body.view.value` |
| `getPageHistory` | `GET /rest/experimental/content/{id}/version?limit={limit}` — `results[]`: `number`, `when`, `by.displayName`, `message` |
| `searchPages` | `GET /rest/api/content/search?cql=...&limit={limit}`, CQL: `type=page AND text ~ "<запрос>"`, кавычки в запросе экранируются |

- `text` — тело страницы без разметки HTML: теги убраны, сущности раскрыты, пустые строки схлопнуты. Длина не больше 20 000 символов, при обрезке `truncated: true`.
- `limit` по умолчанию 10, не больше 50.
- `pageId` — только цифры, иначе ошибка без обращения к сети.
- Ошибки — `Error` с понятным русским текстом: 401 и 403 — «Confluence отклонил токен», 404 — «Страница не найдена», сеть — «Confluence недоступен, проверьте VPN». Токен в текст ошибки не попадает. Таймаут запроса 20 секунд.

`src/server.ts` — инструменты, у всех аннотация `readOnlyHint: true`:

| Инструмент | Аргументы | Ответ |
|---|---|---|
| `get_page_version` | `page_id` | Номер версии, дата, автор, название, ссылка. Лёгкий запрос для наблюдения |
| `get_page` | `page_id` | То же и текст страницы |
| `get_page_history` | `page_id`, `limit?` | Список версий: номер, дата, автор, комментарий |
| `search_pages` | `query`, `limit?` | Список страниц: id, название, ссылка |

Ответ каждого инструмента — одна текстовая часть со строкой JSON. Ошибка клиента — ответ с `isError: true` и текстом ошибки. Описания инструментов на русском, одним предложением.

Скрипт `scripts/check-confluence.ts`: читает `CONFLUENCE_URL` и `CONFLUENCE_TOKEN` из окружения, для страницы из аргумента печатает номер версии, число записей истории и длину текста. Запуск: `npx tsx scripts/check-confluence.ts <id страницы>`.

## Зависимости

`@modelcontextprotocol/sdk` (уже есть). Других не добавлять.

## Как проверить

Тесты `tests/confluence-client.test.ts` с подменой `fetch`:

- `getPageVersion` разбирает номер, дату, автора и собирает ссылку.
- `getPage` убирает теги и сущности; длинное тело обрезается с `truncated: true`.
- `getPageHistory` возвращает версии по порядку из ответа.
- `searchPages` экранирует кавычки в CQL и передаёт `limit`.
- 401 → ошибка про токен, 404 → «Страница не найдена», сбой сети → ошибка про VPN.
- Текст ошибок не содержит токена.
- `pageId` не из цифр → ошибка, `fetch` не вызывался.

Тест `tests/confluence-server.test.ts`: список инструментов сервера содержит четыре инструмента с `readOnlyHint: true`; вызов `get_page_version` с подставным клиентом возвращает JSON с полем `version`.

`npm run build:mcp` создаёт `mcp-servers/confluence/dist/index.js`, запуск без переменных окружения завершается с сообщением об ошибке.

## Не делать

Создание и правку страниц, вложения, комментарии, работу с пространствами.

# 14. MCP Exchange

## Цель

Отдельный MCP-сервер для почты и календаря Exchange: встречи из календаря и ссылки, которые открывают в веб-почте черновик письма или встречи. Сам сервер ничего не отправляет и не создаёт.

## Что сделать

Каталог `mcp-servers/exchange/` с тем же устройством, что у `mcp-servers/confluence/`: `src/client.ts`, `src/links.ts`, `src/server.ts`, `src/index.ts`, `tsconfig.json`. Скрипт `build:mcp` собирает и этот сервер.

Переменные окружения:

| Имя | Пример | Зачем |
|---|---|---|
| `EXCHANGE_EWS_URL` | `https://mail.example.org/EWS/Exchange.asmx` | Адрес службы EWS |
| `EXCHANGE_OWA_URL` | `https://mail.example.org/owa/` | Адрес веб-почты для ссылок |
| `EXCHANGE_USER` | `DOMAIN\user` или `user@example.org` | Учётная запись |
| `EXCHANGE_PASSWORD` | — | Пароль |

Для инструментов календаря нужны первая, третья и четвёртая; для ссылок — только вторая. Нет нужной переменной — инструмент возвращает понятную ошибку, сервер при этом запускается. Пароль не печатается нигде.

`src/client.ts`

```ts
interface Meeting { subject: string; start: string; end: string; location: string; organizer: string; joinUrl?: string }

function createExchangeClient(opts: { ewsUrl: string; user: string; password: string; post?: EwsPost }): {
  listMeetings(from: Date, to: Date): Promise<Meeting[]>;
};

type EwsPost = (url: string, soapBody: string, auth: { user: string; password: string }) => Promise<{ status: number; body: string }>;
```

- Сервер принимает только авторизацию NTLM. Отправка по умолчанию делается через пакет `httpntlm`; домен берётся из `EXCHANGE_USER` вида `DOMAIN\user`. В тестах `post` подменяется.
- Запрос `FindItem` с `CalendarView` (границы в UTC) по папке `calendar`, версия схемы `Exchange2013`. Поля: `item:Subject`, `calendar:Start`, `calendar:End`, `calendar:Location`, `calendar:Organizer`.
- Ответ XML разбирается пакетом `fast-xml-parser`. Одна встреча в ответе и несколько встреч разбираются одинаково.
- `joinUrl`: первая ссылка `https://...` из поля `Location`, если она есть. Тело встречи не запрашивается.
- Встречи отсортированы по времени начала, время в ISO.
- Ошибки: 401 — «Exchange отклонил логин или пароль», сеть — «Почтовый сервер недоступен, проверьте VPN», `ResponseCode` не `NoError` — текст с этим кодом. Таймаут 30 секунд.

`src/links.ts`

```ts
function mailDraftLink(owaUrl: string, p: { to?: string; subject?: string; body?: string }): string;
function meetingDraftLink(owaUrl: string, p: { subject?: string; start: string; end: string; location?: string; body?: string }): string;
```

- Письмо: `<owa>?path=/mail/action/compose&to=...&subject=...&body=...`
- Встреча: `<owa>?path=/calendar/action/compose&subject=...&startdt=...&enddt=...&location=...&body=...`
- `startdt` и `enddt` — местное время в виде `ГГГГ-ММ-ДДTЧЧ:ММ:СС`. Значения кодируются через `encodeURIComponent`. Пустые параметры не добавляются. Адрес веб-почты приводится к виду с одной косой чертой на конце.

`src/server.ts` — инструменты:

| Инструмент | Аргументы | Ответ | readOnlyHint |
|---|---|---|---|
| `list_meetings` | `date?` (`ГГГГ-ММ-ДД`, по умолчанию сегодня), `days?` (по умолчанию 1, не больше 14) | Список встреч | true |
| `next_meeting` | — | Ближайшая встреча, которая ещё не закончилась, из ближайших 24 часов, или сообщение, что встреч нет | true |
| `mail_draft_link` | `to?`, `subject?`, `body?` | Ссылка на черновик письма | true |
| `meeting_draft_link` | `subject?`, `start`, `end`, `location?`, `body?` | Ссылка на черновик встречи | true |

Ответ — одна текстовая часть со строкой JSON: для встреч `{ "meetings": [...] }`, для ссылок `{ "url": "..." }`. Описания инструментов на русском; в описаниях ссылок сказано, что ссылку нужно открыть пользователю, а отправляет он сам.

## Зависимости

`httpntlm`, `fast-xml-parser`. Других не добавлять.

## Как проверить

Тесты `tests/exchange-client.test.ts`, `tests/exchange-links.test.ts` с подменой `post`:

- Ответ с тремя встречами разбирается в три объекта, отсортированных по началу.
- Ответ с одной встречей и ответ без встреч разбираются без ошибок.
- Ссылка в `Location` попадает в `joinUrl`.
- В запросе границы `CalendarView` заданы в UTC и соответствуют переданным датам.
- 401 → ошибка про логин и пароль; `ResponseCode` с ошибкой → текст с кодом; пароль в тексте ошибок не встречается.
- `mailDraftLink` кодирует кириллицу и пробелы, пропускает пустые параметры.
- `meetingDraftLink` даёт `startdt` и `enddt` в местном времени без часового пояса.
- `next_meeting` с подставным клиентом выбирает ближайшую незакончившуюся встречу.

`npm run build:mcp` создаёт `mcp-servers/exchange/dist/index.js`.

## Не делать

Чтение и отправку писем, создание встреч через EWS, работу с чужими календарями.

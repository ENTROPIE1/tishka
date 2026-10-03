# 03. Клиент шлюза моделей

## Цель

Один модуль для всех обращений к моделям ДКС: обычный диалог, вызов инструментов, картинки.

## Что сделать

`src/core/llm/client.ts`

```ts
type ChatMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

type ContentPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };
interface ToolCall { id: string; name: string; args: Record<string, unknown> }

interface ChatRequest { model: string; messages: ChatMessage[]; tools?: ToolDef[]; temperature?: number }
interface ChatResponse { text: string | null; toolCalls: ToolCall[] }

function createLlmClient(opts: { baseUrl: string; getApiKey: () => Promise<string | undefined>; fetch?: typeof fetch }): {
  chat(req: ChatRequest): Promise<ChatResponse>;
};
```

1. Запрос `POST {baseUrl}/chat/completions` в формате OpenAI. `ToolDef` переводится в `tools: [{ type: "function", function: { name, description, parameters } }]`. Картинка передаётся как `image_url` со строкой `data:`.
2. Аргументы вызова инструмента приходят строкой JSON. Если строка не разбирается, вызов возвращается с `args: {}` и не роняет запрос.
3. Повторы: при ответах 429, 500, 502, 503, 504 и сетевой ошибке до трёх попыток с паузой 1, 3 и 7 секунд. Заголовок `Retry-After` учитывается.
4. Таймаут одного запроса 60 секунд.
5. Ошибки: класс `LlmError` с полями `kind: 'auth' | 'limit' | 'network' | 'server' | 'bad_response'` и понятным сообщением на русском. Ключ в сообщение об ошибке и в журнал не попадает.
6. Если ключа нет, `chat` отклоняется с `LlmError` вида `auth` и текстом «Не задан ключ шлюза моделей».

Скрипт `scripts/check-llm.ts`: берёт ключ из переменной окружения `DKS_API_KEY`, отправляет запрос с одним инструментом `get_time` и печатает, вызвала ли модель инструмент. Запуск: `npx tsx scripts/check-llm.ts [имя модели]`.

## Зависимости

Только встроенный `fetch`. Для скрипта разрешён `tsx` в dev-зависимостях.

## Как проверить

Тесты `tests/llm-client.test.ts` с подменой `fetch`:

- Текстовый ответ разбирается в `text`.
- Ответ с вызовом инструмента разбирается в `toolCalls` с объектом аргументов.
- Неразбираемые аргументы дают `args: {}`.
- 429 → повтор → успех. Три неудачи подряд → `LlmError` вида `limit`.
- 401 → `LlmError` вида `auth` без повторов.
- Сообщение с картинкой уходит в формате `image_url`.
- Текст ошибки не содержит ключа.

## Не делать

Потоковую передачу ответа, подсчёт токенов.

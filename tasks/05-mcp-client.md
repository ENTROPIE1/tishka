# 05. MCP-клиент

## Цель

Подключать MCP-серверы из настроек и добавлять их инструменты в общий реестр. Через это Тишка получает Confluence, календарь и любые серверы, которые добавит пользователь.

## Что сделать

`src/core/mcp/manager.ts`

```ts
type McpStatus = { name: string; state: 'connected' | 'error' | 'disabled'; tools: number; error?: string };

function createMcpManager(deps: { registry: ToolRegistry; secrets: SecretStore }): {
  connectAll(servers: McpServerConfig[]): Promise<McpStatus[]>;
  reconnect(server: McpServerConfig): Promise<McpStatus>;
  disconnect(name: string): Promise<void>;
  status(): McpStatus[];
  closeAll(): Promise<void>;
};
```

1. Использовать официальный пакет `@modelcontextprotocol/sdk`: клиент, транспорт Streamable HTTP для `transport: 'http'` и stdio для `transport: 'stdio'`.
2. Перед подключением значения `headers` и `env` проходят через `resolveSecrets` из задачи 02.
3. После подключения запросить список инструментов и зарегистрировать каждый в реестре:
   - имя `<имя сервера>__<имя инструмента>`;
   - `source: "mcp:<имя сервера>"`;
   - `readOnly` берётся из аннотации инструмента `readOnlyHint`, при её отсутствии `false`.
4. Вызов инструмента: текстовые части ответа склеиваются в `content`. Если текст является JSON, он же разбирается в `data`. Ответ с признаком ошибки превращается в `{ ok: false, error }`.
5. Сбой одного сервера не мешает остальным: его статус `error` с коротким текстом причины, приложение продолжает работу.
6. `disconnect` и `reconnect` убирают старые инструменты сервера через `unregisterSource`.
7. Таймаут подключения 10 секунд, вызова инструмента 60 секунд.
8. Значения секретов не попадают в статус, в ошибки и в журнал.

Скрипт `scripts/check-mcp.ts`: подключается к серверу по адресу из аргумента и печатает имена и описания инструментов. Запуск: `npx tsx scripts/check-mcp.ts <адрес>`.

## Зависимости

`@modelcontextprotocol/sdk`.

## Как проверить

Тесты `tests/mcp-manager.test.ts` с подменой клиента:

- Инструменты сервера появляются в реестре с правильными именами и источником.
- Вызов через реестр доходит до сервера и возвращает `content` и `data`.
- Один сервер недоступен → его статус `error`, инструменты второго работают.
- После `disconnect` инструментов сервера в реестре нет.
- Ссылка `${secret:ИМЯ}` в заголовке подставляется; текст ошибки при сбое не содержит значения.

## Не делать

Ресурсы и промпты MCP, экран настроек серверов.

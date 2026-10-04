# 54. Поиск ошибок — ядро (src/core)

Область: `src/core` — `app.ts`, агент и цикл вызова инструментов (`agent/`, `tools/registry.ts`), `conversation.ts`, `history-search.ts`, `history-tool.ts`, `config.ts`, каталоги `memory/`, `skills/`, `web/`, `vision/`, планировщик напоминаний и фоновые задачи (`triggers/`), LLM-клиент, MCP-менеджер.

Находки по убыванию важности. Код по условию задачи не менялся; проверочные тесты написаны, запущены, подтвердили ошибки и из репозитория удалены (их текст приведён здесь).

---

## 1. Переключатели «Интернет» и «Экран» в настройках не действуют до перезапуска приложения

- **Файл:** `src/core/app.ts:239` (`registerWebTools(registry, …, config.web.enabled)`), `src/core/app.ts:262–272` (`registerScreenTools(…, config.screen.enabled)`); причина — `reloadConfig()` в `src/core/app.ts:337–342` после перечитывания настроек только переподключает серверы MCP и не трогает реестр инструментов.
- **Шаги:** в настройках выключить «читать страницы из интернета» (или «смотреть на экран») → «Сохранить» → в чате попросить «прочитай страницу …» (или «что у меня на экране»).
- **Что видит:** Тишка по-прежнему читает страницы из интернета (и делает снимки экрана), хотя в настройках переключатель снят. Запрещённое действие продолжает выполняться, пока приложение не перезапущено.
- **Подтверждено тестом** (падает на `expect(readCalls).toBe(0)` — чтение страницы всё равно произошло):

```ts
it('web.enabled=false после saveConfig должен убирать web_read из инструментов агента', async () => {
  let readCalls = 0;
  const fetchMock = vi.fn<typeof fetch>();
  fetchMock
    .mockResolvedValueOnce(toolChoice('c1', 'web_read', { url: 'https://x.example' }))
    .mockResolvedValueOnce(replyChoice('r1', 'прочитал'));
  const { core } = await setupCore({
    fetch: fetchMock,
    readWeb: async () => {
      readCalls += 1;
      return { ok: true, url: 'https://x.example', title: 'x', text: 'текст', truncated: false, links: [] };
    }
  });

  await core.saveConfig({ ...core.config(), web: { enabled: false } });
  await core.handleUserText('прочитай страницу https://x.example');

  expect(readCalls).toBe(0); // фактически 1 — инструмент выполнился
});
```

(Аналогичный тест для `screen: { enabled: false }` с `captureScreen` тоже падает: снимок делается.)

- **Как исправить:** в `reloadConfig()` (или внутри `saveConfig`) переприменять регистрацию: при выключении вызывать `registry.unregisterSource('builtin')` для соответствующих имён и регистрировать заново при включении, либо передавать в обработчики проверку актуального `config.web.enabled`/`config.screen.enabled` на момент вызова.

## 2. Смена адреса шлюза и vision-модели в настройках не действует до перезапуска

- **Файл:** `src/core/app.ts:249–253` (`createLlmClient({ baseUrl: config.llm.baseUrl, … })` — значение захвачено при старте), `src/core/app.ts:257–261` (`createVisionLook({ …, visionModel: config.llm.visionModel })` — то же). Имя основной модели, в отличие от них, читается через `getModel: () => config.llm.model` и обновляется.
- **Шаги:** в настройках поменять адрес шлюза (например, при переезде шлюза или опечатке в адресе) → «Сохранить» → задать любой вопрос.
- **Что видит:** настройки показывают новый адрес, но запросы продолжают уходить на старый; при недоступном старом адресе — «Не получилось связаться со шлюзом моделей» на каждую реплику до перезапуска приложения. Смена `visionModel` ломает так же `screen_look`.
- **Подтверждено тестом:**

```ts
it('смена baseUrl настроек должна применяться к запросам модели без перезапуска', async () => {
  const urls: string[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (url) => {
    urls.push(String(url));
    return jsonResponse({ choices: [{ message: { content: 'ок' } }] });
  });
  const { core } = await setupCore({ fetch: fetchMock });

  await core.handleUserText('первый');
  await core.saveConfig({ ...core.config(), llm: { ...core.config().llm, baseUrl: 'https://new-gw.example/v1' } });
  await core.handleUserText('второй');

  expect(urls[1]).toContain('new-gw.example');
  // фактически: 'https://llm.dks.lanit.ru/v1/chat/completions' — старый адрес
});
```

- **Как исправить:** передавать в `createLlmClient` и `createVisionLook` геттеры (`getBaseUrl: () => config.llm.baseUrl`, `getVisionModel: () => config.llm.visionModel`) и читать их при каждом запросе, как это уже сделано для имени модели в агенте.

## 3. Параллельное переподключение сервера MCP оставляет висящее подключение (лишний процесс сервера)

- **Файл:** `src/core/mcp/manager.ts:122–144` (`connectOne`), гонка с `src/core/app.ts:321` (`mcpTask = applyMcpServers(…)` в фоне), `src/core/app.ts:337–342` (`reloadConfig` → `applyMcpServers`) и `src/core/app.ts:349–360` (`reconnect` из экрана подключений).
- **Шаги:** сервер MCP подключается медленно (например, стартует до 10 секунд) → в этот момент пользователь сохраняет настройки подключений (`saveConfig` → `applyMcpServers`) или нажимает «Переподключить» у этого же сервера (или дважды быстро).
- **Что видит:** оба вызова `connectOne` проходят `drop()` до того, как первый положил подключение в `live`, и создают по своему соединению. Проигравший коннект не попадает в `live` и никогда не закрывается: для stdio это зависший дочерний процесс MCP-сервера, который переживёт и `stop()`, и выход из приложения; плюс лишние регистрации инструментов. Видимого ответа пользователю нет — проблема всплывает как «висящие» процессы node в диспетчере задач и двойные фоновые вызовы.
- **Подтверждено чтением кода:** в `connectOne` между `await drop(name)` и `live.set(name, …)` нет взаимного исключения по имени; второй параллельный вызов для того же имени не видит первый (`live` ещё пуст), и его соединение остаётся незакрытым (`closeAll` закрывает только то, что в `live`).
- **Как исправить:** сериализовать `connectOne` по имени сервера (цепочка обещаний на каждое имя, как в `state.exclusive`), чтобы второй вызов ждал завершения первого и закрывал его подключение через `drop`.

## 4. «Новый разговор» во время ответа ломает контекст: последующие реплики падают до следующего сброса

- **Файл:** `src/core/app.ts:134–142` (`newConversation` → `agent.reset()` вне очереди обработки) и `src/core/agent/agent.ts:109–153` (цикл `respond` продолжает писать в очищенную историю).
- **Шаги:** задать вопрос, требующий инструмента (Тишка «думает»/выполняет инструмент) → в этот момент нажать «новый разговор» → дождаться ответа → задать любой следующий вопрос.
- **Что видит:** текущий ответ досматривается без системного сообщения и без вопроса пользователя (модель видит только результат инструмента), а в историю агента остаётся «висячий» результат инструмента. Следующий запрос уходит в шлюз в виде `[system, tool, user]` — сообщение `tool` без предшествующего вызова ассистента, шлюз отклоняет его, и каждая следующая реплика получает «Шлюз моделей ответил что-то непонятное», пока пользователь снова не нажмёт «новый разговор».
- **Подтверждено тестом:**

```ts
it('newConversation во время вызова инструмента не должен оставлять висячий tool-результат в контексте', async () => {
  let releaseOpen: (() => void) | undefined;
  const gate = new Promise<void>((resolveGate) => { releaseOpen = resolveGate; });
  const bodies: string[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) return toolChoice('c1', 'open_urls', { urls: ['https://a.example'] });
    return replyChoice(`r${bodies.length}`, 'ок');
  });
  const { core, openExternal } = await setupCore({ fetch: fetchMock });
  openExternal.mockImplementation(() => gate);

  const pending = core.handleUserText('открой страницу https://a.example');
  await waitFor(() => bodies.length >= 1 && openExternal.mock.calls.length > 0);

  core.newConversation();          // сброс посреди цикла инструментов
  releaseOpen?.();
  await pending;

  await core.handleUserText('второй вопрос');

  const messages = (JSON.parse(bodies[bodies.length - 1]) as { messages: Array<{ role: string }> }).messages;
  expect(messages[0]?.role).toBe('system');
  expect(messages[1]?.role).toBe('user'); // фактически messages[1].role === 'tool'
});
```

- **Как исправить:** `newConversation()` ставить в ту же очередь, что и `handleUserText` (выполнять сброс только между ходами), либо в `agent.reset()` помечать текущий ход отменённым и игнорировать его дальнейшие `push`.

## 5. Навык с неразборчивым полем `at` молча никогда не запускается

- **Файл:** `src/core/skills/validate.ts:97–102` (любая непустая строка в `at` проходит проверку) и `src/core/triggers/scheduler.ts:126–131` (`Date.parse` дал `NaN` → `continue` без сообщения).
- **Шаги:** попросить Тишку сохранить навык «завтра утром напомни…» — модель записывает `trigger.at` не-ISO строкой (например, «завтра утром»); проверка навыка её пропускает → наступает любой момент времени.
- **Что видит:** ничего. Ни запуска, ни события `error`, ни записи в состоянии навыка: планировщик при каждой проверке молча пропускает навык. В `skills_overview` он выглядит как обычный разовый навык, который «ещё не срабатывал».
- **Подтверждено тестом** (навык с `at: 'завтра утром'`, два `scheduler.tick()` через день — событий `error` ноль, запусков ноль):

```ts
it('навык с неразборчивым полем at должен давать ошибку, а не молча никогда не запускаться', async () => {
  const saved = validateSkill({
    format: 'tishka-skill/1', id: 'once', name: 'Раз', description: '', phrases: [],
    trigger: { type: 'schedule', at: 'завтра утром' },
    steps: [{ id: 'step', tool: 'noop', args: {} }]
  });
  expect(saved.ok).toBe(true); // проверка пропускает мусорное время

  // … создаётся createScheduler с этим навыком, tick() сейчас и через сутки …

  const errors = events.filter((event) => event.type === 'error');
  expect(errors.length).toBeGreaterThan(0); // фактически 0
});
```

- **Как исправить:** в `validateSkill` проверять, что строка `at` разбирается `Date.parse` (иначе ошибка проверки), и/или в `processState` при `Number.isNaN(at)` один раз помечать навык ошибкой с событием `error`.

## 6. Пустой ответ модели превращается в пустую реплику без пояснения

- **Файл:** `src/core/agent/agent.ts:129–133` (`const text = response.text ?? ''`), `src/core/agent/reply.ts:91–99` (`replyFromText('')` → `{ say: '' }`), `src/core/agent/reply.ts:136–137` (`replyFromToolArgs` при отсутствии `say` и пустом `fallbackText` даёт `say: ''`).
- **Шаги:** задать любой вопрос, шлюз возвращает успешный ответ с пустым `content` (или `content: null`) и без вызовов инструментов.
- **Что видит:** в чате пустое облачко от Тишки, вслух ничего не произносится; пользователь не получает ни ответа, ни объяснения, что что-то пошло не так.
- **Подтверждено тестом:**

```ts
it('пустой текст модели без вызовов инструментов не должен давать пустой say', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    jsonResponse({ choices: [{ message: { content: '' } }] }));
  const { core } = await setupCore({ fetch: fetchMock });

  const reply = await core.handleUserText('привет');

  expect(reply.say.length).toBeGreaterThan(0); // фактически reply.say === ''
});
```

- **Как исправить:** в `respond()` при пустом тексте и отсутствии вызовов инструментов возвращать осмысленную реплику вида «Не получилось ответить, попробуй ещё раз» (mood confused), вместо `replyFromText('')`.

## 7. Сбой необязательного файла при старте оставляет ядро навсегда «не проснувшимся»

- **Файл:** `src/core/app.ts:219–232` (`started = true` до всех шагов; исключение из `historyStore.start()` — синхронные `mkdirSync/readFileSync/writeFileSync` в `src/core/history.ts:154–164` — или из `skills.loadPresets` → `writeJsonAtomically` прерывает `start()`), `src/core/app.ts:210–217` (`started` не сбрасывается, повторный `start()` невозможен).
- **Шаги:** файл `history.jsonl` занят другой программой (антивирус, синхронизация) или каталог недоступен в момент запуска → `start()` падает посередине.
- **Что видит:** главное окно лишь пишет ошибку в консоль (`src/main/index.ts:133–137`), событие `error` пользователю не отправляется; ядро осталось `started = true` без `router`, и на каждую реплику Тишка отвечает «Я ещё не проснулся, дай мне мгновение» — до перезапуска приложения, где высока вероятность повторить неудачу.
- **Подтверждено чтением кода:** `started` выставляется первой строкой `start()`; ни один шаг не откатывает его, повторный вызов `start()` выходит по `if (started) return;`.
- **Как исправить:** выставлять `started = true` только после успешного завершения всех шагов (в начале ставить флаг «запускается»), а необязательные шаги (история, пресеты) изолировать в собственные `try/catch` с событием `error`, чтобы сбой одного файла не убивал всё ядро.

## 8. Событие `memory.changed` отсутствует в `docs/contracts.md`

- **Файл:** `src/core/types.ts:58` (событие объявлено), `src/core/app.ts:476,483,490` и `src/core/memory/tools.ts:34` (отправляется), `src/renderer/settings/memory-section.ts:177` (используется окном настроек).
- **Шаги:** открыть `docs/contracts.md`, раздел «События» — типа `memory.changed` в списке нет, при этом это часть публичной шины событий, на которую завязан экран памяти.
- **Что видит:** читатель контракта (или агент по будущей задаче) считает список событий исчерпывающим и не узнает о событии, меняющем экран памяти.
- **Подтверждено чтением кода** (grep по `memory.changed`: тип, три эмиттера в `app.ts`, эмиттер в `memory/tools.ts`, обработчик в renderer).
- **Как исправить:** добавить строку `| { type: 'memory.changed' }` в `TishkaEvent` в `docs/contracts.md` (само менять `docs/` по правилам задачи нельзя — требуется отдельное изменение контракта).

---

## Что просмотрено и ошибок не найдено

- `src/core/conversation.ts` — часы разговора: сброс по 30 минутам, служебные реплики не продлевают разговор; поведение совпадает с тестами и контрактом.
- `src/core/history-search.ts`, `src/core/history-tool.ts` — нормализация «ё», пропуск разделителей, лимит 10, пустой запрос, `describe` для всех типов `from`; ошибок не найдено.
- `src/core/config.ts` — повреждённый/пустой `config.json` даёт значения по умолчанию, все поля с проверкой типов, атомарная запись; ошибок не найдено.
- `src/core/tools/registry.ts` — `call` никогда не бросает, ошибки возвращаются как `{ ok: false, error }`, `background.tick` вместо `tool.start/tool.end`; соответствует контракту.
- `src/core/llm/client.ts` — таймаут 60 с с `AbortController`, повторные попытки для 429/5xx с учётом `Retry-After`, разбор повреждённого ответа даёт `bad_response`; утечек таймеров нет.
- `src/core/memory/*` (store, file, search, prompt, tools, tool-defs, review) — цепочка `exclusive` на запись, разбор повреждённого файла устойчив, поиск чистый, обзорщик памяти останавливает таймер в `stop()`.
- `src/core/skills/*` (store, validate, runner, template, match, as-tools, describe, overview, presets, tools) — атомарная запись, уникальные id при импорте, проверка секретов и подстановок; ошибок помимо п. 5 не найдено.
- `src/core/web/*` и `tools/web.ts`, `tools/wiki.ts` — запрет внутренних адресов выдерживает нормализацию WHATWG URL (хекс/восьмеричные IPv4, IPv6-mapped, завершающая точка — всё блокируется), таймауты снимаются в `finally`.
- `src/core/vision/look.ts` — таймаут снимает обещание, ошибки схемы/модели переведены в понятные сообщения.
- `src/core/triggers/*` (scheduler, watcher, state, tools, cron) — таймеры останавливаются в `stop()`, состояние пишется атомарно через `exclusive`, пропущенные напоминания старше 12 часов не дёргаются, повторное срабатывание cron за одну минуту предотвращено; ошибок помимо п. 5 не найдено.
- `src/core/mcp/connection.ts` — таймауты на подключение и вызов, закрытие клиента при сбое подключения.
- Очередь `handleUserText` в `app.ts` корректно сериализует ходы и переживает исключения (`task.catch(() => undefined)`).

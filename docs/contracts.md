# Контракты

Общие типы и правила, на которые опираются все задачи. Если задача требует изменить контракт, сначала меняется этот файл, потом код. Типы живут в `src/core/types.ts`.

## Структура каталога

```
tishka/
  src/
    main/          главный процесс Electron: окна, IPC, запуск ядра
    core/          ядро без зависимости от Electron UI
      llm/         клиент шлюза моделей
      tools/       реестр и встроенные инструменты
      mcp/         MCP-клиент
      agent/       агентный цикл
      skills/      хранилище и исполнитель навыков
      triggers/    расписание и наблюдения
      secrets/     хранилище секретов
      events.ts    шина событий
      config.ts    настройки
      types.ts     общие типы
    renderer/      окна: pet, chat, settings, gallery
    voice/         вызов по имени, распознавание, синтез
  mcp-servers/     свои MCP-серверы, по одному на систему
    confluence/    страница, версия, история, поиск
    exchange/      календарь, ссылки на черновики
    jira/          задачи (низкий приоритет)
  presets/         готовые навыки *.tishka.json
  assets/tishka/   файлы персонажа
  tests/           тесты vitest
  tasks/           задачи
  docs/            документация
```

Каталог данных пользователя: `app.getPath('userData')`. В нём `config.json`, `secrets.bin`, `skills/`, `history.jsonl`, `triggers.json`, `stats.json`.

## Инструменты

```ts
interface ToolDef {
  name: string;                 // для MCP: "<сервер>__<инструмент>"
  description: string;
  inputSchema: object;          // JSON Schema
  source: 'builtin' | 'skill' | `mcp:${string}`;   // 'skill' — навык, доступный агенту как инструмент
  readOnly: boolean;            // false — инструмент что-то меняет
}

interface ToolResult {
  ok: boolean;
  content: string;              // текст для модели
  data?: unknown;               // структурированный результат для шагов навыка
  reply?: Reply;                // готовый ответ человеку: агент завершает ход без второго шага модели,
                                // только если это единственный вызов инструмента в шаге, он не из навыка
                                // и инструмент подтвердил прямой ответ (screen_look: answer_directly=true)
  error?: string;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface ToolRegistry {
  register(def: ToolDef, handler: ToolHandler): void;
  unregisterSource(source: ToolDef['source']): void;
  list(): ToolDef[];
  call(name: string, args: Record<string, unknown>, opts?: { background?: boolean }): Promise<ToolResult>;
}
```

`call` никогда не бросает исключение: ошибка возвращается как `{ ok: false, error }`.

При `opts.background === true` события `tool.start` и `tool.end` не отправляются, вместо них — `background.tick` с именем вызванного инструмента. Так фоновые проверки наблюдений и расписания не переводят окно-питомец в состояние «работает».

## Ответ Тишки

```ts
type Mood = 'neutral' | 'happy' | 'confused';

type Panel =
  | { kind: 'list'; title: string; items: { title: string; subtitle?: string; url?: string }[] }
  | { kind: 'text'; title: string; markdown: string }
  | { kind: 'image'; title: string; path: string };

interface Reply {
  say: string;      // вслух: до двух коротких предложений, без цифр и латиницы
  show?: Panel;     // подробности в панели и в чате
  ask?: { title: string; placeholder?: string };   // просьба прислать текст: окно показывает карточку ввода
  mood?: Mood;
  moods?: MoodMark[];   // смены эмоции внутри реплики
}

interface MoodMark {
  at: number;     // позиция в знаках очищенного say
  mood: string;   // имя из assets/tishka/model/moods.json
}
```

Ядро вырезает из `say` только метки вида `[слово]` — от двух до двадцати латинских букв или подчёркиваний и не перед круглой скобкой; ссылки markdown `[текст](адрес)`, сноски `[1]` и прочее в скобках остаются как есть. Известные имена из `moods.json` становятся `moods` с позицией в знаках очищенного `say`, неизвестные слова такого вида просто убираются. Тем же правилом очищается `markdown` карточки текстового ответа. Список эмоций берётся из данных модели: `assets/tishka/model/moods.json` (имя — глаза, брови, рот покоя, эффекты); для персонажа «Тишка» строка о метках добавляется в подсказку модели, при прежнем еже метки ни на что не влияют.

Режим ответа (`voice` — вслух и текстом, `text` — только текстом) хранится в `Config.voice.tts.enabled` и переключается инструментом ядра `speech_mode` без перезапуска. В ядро источник реплики человека (`'voice'` или `'text'`) доводится необязательным параметром `handleUserText(text, source?)`; текущий режим и источник попадают в системную подсказку хода.

## Озвучка реплики

При `Config.voice.tts.bySentence` (по умолчанию включено) подготовленный текст реплики делится на части по границам предложений (`.`, `!`, `?`, `…`, перевод строки); точка внутри числа, сокращения и служебные слова («т. е.», «5.10», «и т. д.») границей не считаются. Предложение длиннее 300 знаков делится по запятой или точке с запятой; предложения короче 25 знаков присоединяются к соседнему, кроме первой части — она может остаться короткой, чтобы звук начался быстрее. Первая часть уходит на синтез сразу и звучит, как только готова; следующая синтезируется, пока звучит предыдущая, с опережением не больше одной части; пауза между частями при воспроизведении 150 мс. Остановка речи, вытеснение новой репликой и страховочный срок действуют на реплику целиком: остановка обрывает звук и отменяет ещё не синтезированные части. Ошибка синтеза одной части не обрывает остальные. Прогрев готовых фраз идёт по одному запросу и приостанавливается на время синтеза живой реплики; сохранение настроек, не менявшее адрес службы синтеза и не включавшее озвучку, прогрев не запускает. При выключенной настройке реплика уходит одним запросом, как раньше.

## Рот и эмоции

Модуль `src/voice/lipsync.ts` (чистые функции) по тексту, ушедшему в синтез, и огибающей громкости его WAV строит дорожку форм рта (`m_closed`, `m_teeth`, `m_e`, `m_a`, `m_o`, `m_u`, `m_f`, `m_l`) и моменты смены эмоций. Главный процесс считает её из WAV перед воспроизведением и передаёт окну ежа вместе со звуком (`SpeakMessage.mouth`, `SpeakMessage.moods`); дорожка рта и эмоции идут по `audio.currentTime`. Если дорожки нет, рот ведётся по громкости, как раньше.

Для реплики, разбитой на части, дорожка рта и моменты эмоций строятся по каждой части: дорожка — из её текста и её WAV. Метка эмоции (`Reply.moods`, позиция в знаках текста `say` до подготовки) попадает в ту часть, где лежит её позиция, с пересчётом позиции относительно начала части; позиция переводится по доле длины, так как части — это подготовленный текст.

Переходник `Character` получает необязательные `setViseme(shape | null)` (форма рта из дорожки) и `setMood(name)` (эмоция из данных модели). Прежний ёж их не реализует и продолжает жить на `setMouth(level)`.

Настроение ответа (`Reply.mood`) задаёт эмоцию лица нового персонажа в начале реплики — и при ответе вслух, и при ответе текстом без звука; метки `[эмоция]` меняют её дальше по ходу речи. Возвращение в покой (`idle`, `sleep`, `hidden`) или уход (`leave`) сбрасывает эмоцию в `neutral`. Прежнего ежа это не касается.

## Снимок экрана

`screen_look` сохраняет снимок в каталог `screenshots` с тем же пределом файлов, что и `screen_shot`, и отправляет событие `screenshot` с путём к файлу. Окно чата показывает снимок отдельной строкой ленты перед ответом; в облачке и карточке ежа он не показывается, в контекст основной модели картинка повторно не уходит. История хранит снимок ссылкой на файл; если файл удалён пределом числа снимков, в ленте на его месте приглушённая строка «Снимок экрана удалён».

## События

```ts
type TishkaEvent =
  | { type: 'wake'; source: 'name' | 'hotkey' | 'click' | 'trigger' }
  | { type: 'listen.start' }
  | { type: 'listen.end'; text: string }
  | { type: 'think.start' }
  | { type: 'tool.start'; tool: string }
  | { type: 'tool.end'; tool: string; ok: boolean }
  | { type: 'status'; text: string }   // текст в облачке, состояние не меняется
  | { type: 'note'; text: string }     // приглушённая служебная строка в ленте чата, не вслух
  | { type: 'reply'; reply: Reply }
  | { type: 'screenshot'; title: string; path: string }   // снимок в ленте чата: в облачке и карточке ежа не показывается
  | { type: 'speak.start'; text: string }
  | { type: 'speak.level'; level: number }   // 0..1
  | { type: 'speak.end' }
  | { type: 'notify'; title: string; skillId?: string }
  | { type: 'background.tick'; tool: string }
  | { type: 'skill.saved'; skillId: string; source?: 'dialog' | 'screen' }   // 'dialog' — сохранён в разговоре, 'screen' — на экране автоматизаций
  | { type: 'memory.changed' }
  | { type: 'calendar.changed' }   // календарь изменился: экран перечитывает
  | { type: 'skill.removed'; skillId: string }
  | { type: 'stats.changed' }          // счётчик выполненных дел изменился
  | { type: 'error'; message: string }
  | { type: 'idle' };

interface EventBus {
  emit(event: TishkaEvent): void;
  on(listener: (event: TishkaEvent) => void): () => void;   // возвращает отписку
}
```

## Навык

Файл `<id>.tishka.json`.

```ts
interface Skill {
  format: 'tishka-skill/1';
  id: string;                    // латиница, цифры, дефис
  name: string;                  // «Утро пятницы»
  description: string;
  phrases: string[];             // фразы вызова
  trigger: Trigger;
  inputs?: SkillInput[];
  steps: Step[];
  requires?: string[];           // имена серверов из mcpServers: "confluence", "exchange"
  enabled?: boolean;             // нет поля — включён; выключенный не запускается сам и не идёт агенту
  manualMinutes?: number;        // сколько минут дело занимает руками, по умолчанию 5
}

type Trigger =
  | { type: 'manual' }
  | { type: 'schedule'; at?: string; cron?: string }          // at — ISO-время разового запуска
  | { type: 'watch'; tool: string; args: Record<string, unknown>; everyMinutes: number; field?: string };

interface SkillInput { name: string; description: string; required: boolean; default?: unknown }

type Step =
  | { id: string; tool: string; args: Record<string, unknown> }   // вызов инструмента
  | { id: string; ask: string }                                   // запрос к модели, результат — текст
  | { id: string; say: string; show?: Panel };                    // реплика пользователю
```

Подстановки в строках `args`, `ask`, `say`: `{{inputs.имя}}`, `{{steps.id.content}}`, `{{steps.id.data.путь}}`, `{{now}}`, `{{today}}`.

В файле навыка не бывает секретов.

## Счётчик дел

Ядро ведёт счётчик выполненных дел в `stats.json` каталога данных. Дело — выполненный навык, сработавшая автоматизация, созданный черновик письма, найденная страница, событие календаря или напоминание.

```ts
type DeedKind = 'skill' | 'automation' | 'draft' | 'page' | 'event' | 'reminder';

interface Deed {
  id: string;
  kind: DeedKind;
  title: string;
  at: string;                 // ISO момента выполнения
  minutes: number;            // сколько минут это заняло бы руками
  durationMs?: number;        // сколько заняло у Тишки (навык)
  steps?: number;             // сколько шагов в навыке
  skillId?: string;
}

interface StatsPeriod { deeds: number; minutes: number }

interface StatsSummary {
  today: StatsPeriod;
  week: StatsPeriod;          // текущая неделя, с понедельника
  total: StatsPeriod;
  bySkill: { skillId: string; name: string; deeds: number; minutes: number }[];
  byWeekday: StatsPeriod[];   // текущая неделя, 0 — понедельник … 6 — воскресенье
  recent: Deed[];             // последние дела, новые первыми
}
```

Сэкономленные минуты навыка берутся из `Skill.manualMinutes`, по умолчанию 5. Для остальных дел действуют постоянные оценки: черновик письма — 8, событие календаря — 5, страница — 3, напоминание — 1. Завершение дела отправляет событие `stats.changed`. Повреждённый файл читается как пустой и не роняет ядро; запись атомарная. Инструмент ядра `stats_summary` отдаёт содержимое сводки.

## Календарь

Ядро хранит события в `calendar.json` в каталоге данных (`src/core/calendar/`).

```ts
type CalendarKind = 'meeting' | 'focus' | 'personal' | 'reminder' | 'away';
type CalendarSource = 'local' | `exchange:${string}` | 'schedule';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;                 // ISO со смещением
  end: string;
  allDay: boolean;
  kind: CalendarKind;
  source: CalendarSource;
  externalId?: string;           // идентификатор в источнике загрузки
  location?: string;
  link?: string;                 // ссылка на подключение к встрече
  note?: string;
  remindMinutes: number | null;  // null — не напоминать
  updatedAt: string;
}
```

Свои события (`source: local`) человек правит и удаляет. Загруженные (`exchange:<имя>`) правятся только по `remindMinutes` и `note`; исчезнувшие в источнике удаляются следующей загрузкой. События `source: schedule` — напоминания и разовые запуски навыков — видны из хранилища расписания только для чтения, без копирования. Запись файла атомарная, повреждённый файл даёт пустой календарь и строку в журнале времени.

Напоминание о событии — `notify` за `remindMinutes` до начала, одно на событие; после перезапуска пропущенное больше чем на пять минут не шлётся. Во время события `focus` уведомления навыков и слежения копятся и после его конца показываются строкой `note`.

Инструменты Тишки: `calendar_agenda` (сегодня, завтра, неделя или даты), `calendar_add` (при пересечении событие всё равно создаётся, пересечение сообщается), `calendar_update` и `calendar_remove` (только свои события), `calendar_free` (свободные окна в рабочее время), `calendar_status` (обстановка сейчас). Разбор дат живёт отдельным модулем и понимает «завтра в 15», «в пятницу с 10 до 11», «через час на 30 минут». В системную подсказку каждого хода входит одна-две строки обстановки.

## Секреты и настройки

```ts
interface SecretStore {
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | undefined>;   // только главный процесс
  has(name: string): Promise<boolean>;
  delete(name: string): Promise<void>;
  names(): Promise<string[]>;
}

interface Config {
  llm: { baseUrl: string; model: string; visionModel: string; fallbackModel: string; visionFallbackModel: string; api: 'chat' | 'responses' };   // fallbackModel/visionFallbackModel — запасные модели на случай отказа основных (пусто — нет запасной); api — формат запросов к шлюзу: 'chat' (по умолчанию, /chat/completions) или 'responses' (/responses, формат OpenAI Responses)
  voice: { hotkey: string; wakeWords: string[]; wakeEnabled: boolean; talkByDefault: boolean; talkTimeoutSec: number; sensitivity: 'low' | 'normal' | 'high'; mic: { threshold: number | null; noise: number | null; speech: number | null; calibratedAt: string | null }; sttUrl: string; stt: { exe: string; model: string; audioCtx: number; threads: number; mode: 'local' | 'remote' }; tts: { enabled: boolean; url: string; volume: number; bySentence: boolean } };   // stt.mode: local — запускать службу здесь; remote — готовая служба по sttUrl; bySentence — озвучивать по предложениям, не дожидаясь всего текста (по умолчанию включено)
  mcpServers: McpServerConfig[];
  persona: { fyr: 'off' | 'sometimes' | 'often'; character: 'hedgehog' | 'tishka' };   // как часто Тишка говорит «фыр»; показываемый персонаж: 'hedgehog' (прежний ёж, по умолчанию) или 'tishka' (костная модель)
  calendar: {
    workHours: { days: Partial<Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', { start: string; end: string } | null>>; lunch?: { start: string; end: string } };   // рабочее время по дням недели, null — выходной; по умолчанию пн–пт 09:00–18:00
    defaultRemindMinutes: number;   // за сколько минут напоминать по умолчанию
    quietOutsideWork: boolean;      // вне рабочего времени не напоминать вслух о рабочих встречах
    sources?: Record<string, boolean>;   // имя подключения Exchange — загружать встречи (задача 106)
  };
  pet: { x: number | null };   // положение окна-питомца по горизонтали, null — у правого края
  petMode: boolean;
  screen: { enabled: boolean };   // разрешено ли смотреть на экран, по умолчанию true
  web: { enabled: boolean };      // разрешено ли читать страницы из интернета, по умолчанию true
  app: { warmMinutes: number; memoryLimitMb: number; autostart: boolean };   // держать микрофон наготове, предел памяти приложения вместе со службой распознавания, запуск вместе с Windows
}

type McpServerConfig =
  | { name: string; transport: 'http'; url: string; headers?: Record<string, string> }
  | { name: string; transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };
```

В `headers` и `env` секрет записывается ссылкой `${secret:ИМЯ}`. Подстановка происходит в главном процессе в момент подключения. Значение секрета не попадает в `config.json`, в журналы, в окна, в сообщения модели.

Один запущенный сервер — одно подключение к одному экземпляру системы. Адрес и учётные данные сервер получает через `env` (например `CONFLUENCE_URL`, `CONFLUENCE_TOKEN`). Чтобы работать с двумя экземплярами одной системы, тот же сервер добавляется в `mcpServers` дважды с разными именами и своими секретами:

```json
[
  { "name": "confluence", "transport": "stdio", "command": "node", "args": ["mcp-servers/confluence/dist/index.js"],
    "env": { "CONFLUENCE_URL": "https://wiki.example.org", "CONFLUENCE_TOKEN": "${secret:CONFLUENCE_TOKEN}" } },
  { "name": "confluence-2", "transport": "stdio", "command": "node", "args": ["mcp-servers/confluence/dist/index.js"],
    "env": { "CONFLUENCE_URL": "https://docs.example.org", "CONFLUENCE_TOKEN": "${secret:CONFLUENCE_2_TOKEN}" } }
]
```

Инструменты экземпляров различаются именем сервера: `confluence__get_page` и `confluence-2__get_page`. Имя сервера уникально в пределах `mcpServers`. В `requires` навыка указывается имя сервера.

Имена секретов произвольные. По умолчанию: `DKS_API_KEY`, `CONFLUENCE_TOKEN`, `EXCHANGE_PASSWORD`; для следующих экземпляров `<СИСТЕМА>_<N>_TOKEN`.

## Модель

Шлюз совместим с OpenAI API (`/chat/completions`). Адрес и имена моделей берутся из `Config.llm`, ключ из `SecretStore` (`DKS_API_KEY`). В тестах и скриптах проверки ключ читается из переменной окружения `DKS_API_KEY`. При `llm.api === 'responses'` клиент отправляет запросы в формате OpenAI Responses (`POST <адрес>/responses`) и приводит ответы к тому же внутреннему виду; остальной код о формате не знает. Неизвестное значение `llm.api` читается как `'chat'`.

Проверка шлюза без сохранения настроек — канал `tishka:config:check-gateway`. Принимает `{ baseUrl: string; model: string; key?: string; api?: 'chat' | 'responses' }`, ключ из поля важнее сохранённого, неизвестный формат читается как `'chat'`. Возвращает `{ ok: boolean; models: string[]; error?: string; ms: number }`. Ключ в окно не возвращается. Адрес нормализуется: пробелы по краям и завершающие `/` убираются, хвост `/chat/completions` отбрасывается, адрес без `http://` или `https://` — ошибка. Экран «Подключения» → «Модель» проверяет основную и запасную модели по отдельности и показывает результат по каждой.

При ошибке сервера (HTTP 5xx, отказ соединения, истечение времени ожидания) запрос один раз повторяется на запасной модели, если она задана и отличается от основной; при ошибках 4xx перехода нет. После перехода следующие 5 минут запросы идут сразу на запасную, затем снова пробуется основная. Отмена человеком переходом не считается. При переходе в ленту чата уходит одна приглушённая строка `note` «Модель <имя> не отвечает, работаю на <запасная>» (вслух не читается) и в журнал времени — `model.fallback from=… to=… reason=…`. Если запасной нет или она тоже отказала, сообщение называет модель и причину и ведёт в настройки; «Шлюз недоступен» остаётся только для недоступного адреса шлюза. При исчерпанном дневном лимите ключа (`exceeded budget` в теле ответа) сообщение отдельное — «На модель <имя> сегодня исчерпан лимит», тело ответа шлюза в ленту, историю и журналы не попадает.

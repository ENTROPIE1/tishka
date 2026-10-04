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

Каталог данных пользователя: `app.getPath('userData')`. В нём `config.json`, `secrets.bin`, `skills/`, `history.jsonl`, `triggers.json`.

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
  error?: string;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface ToolRegistry {
  register(def: ToolDef, handler: ToolHandler): void;
  unregisterSource(source: ToolDef['source']): void;
  list(): ToolDef[];
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}
```

`call` никогда не бросает исключение: ошибка возвращается как `{ ok: false, error }`.

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
}
```

## События

```ts
type TishkaEvent =
  | { type: 'wake'; source: 'name' | 'hotkey' | 'click' | 'trigger' }
  | { type: 'listen.start' }
  | { type: 'listen.end'; text: string }
  | { type: 'think.start' }
  | { type: 'tool.start'; tool: string }
  | { type: 'tool.end'; tool: string; ok: boolean }
  | { type: 'reply'; reply: Reply }
  | { type: 'speak.start'; text: string }
  | { type: 'speak.level'; level: number }   // 0..1
  | { type: 'speak.end' }
  | { type: 'notify'; title: string; skillId?: string }
  | { type: 'skill.saved'; skillId: string }
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
  llm: { baseUrl: string; model: string; visionModel: string };
  voice: { hotkey: string; wakeWords: string[]; wakeEnabled: boolean; talkTimeoutSec: number; sensitivity: 'low' | 'normal' | 'high'; sttUrl: string; stt: { exe: string; model: string; audioCtx: number; threads: number }; ttsEngine: 'piper' | 'silero' | 'none' };
  mcpServers: McpServerConfig[];
  persona: { fyr: 'off' | 'sometimes' | 'often' };   // как часто Тишка говорит «фыр», по умолчанию 'sometimes'
  pet: { x: number | null };   // положение окна-питомца по горизонтали, null — у правого края
  petMode: boolean;
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

Шлюз совместим с OpenAI API (`/chat/completions`). Адрес и имена моделей берутся из `Config.llm`, ключ из `SecretStore` (`DKS_API_KEY`). В тестах и скриптах проверки ключ читается из переменной окружения `DKS_API_KEY`.

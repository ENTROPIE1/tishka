import type { CalendarConfig } from './calendar/types';

export interface ToolDef {
  name: string;                 // для MCP: "<сервер>__<инструмент>"
  description: string;
  inputSchema: object;          // JSON Schema
  source: 'builtin' | 'skill' | `mcp:${string}`;
  readOnly: boolean;            // false — инструмент что-то меняет
}

export interface ToolResult {
  ok: boolean;
  content: string;              // текст для модели
  data?: unknown;               // структурированный результат для шагов навыка
  reply?: Reply;                // готовый ответ человеку: агент завершает ход без второго шага модели,
                                // только если это единственный вызов инструмента в шаге, он не из навыка
                                // и инструмент подтвердил прямой ответ (screen_look: answer_directly=true)
  error?: string;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolCallOptions {
  background?: boolean;         // true — не слать tool.start и tool.end, вместо них background.tick
}

// Вопрос человеку перед меняющим инструментом: идентификатор, подключение,
// инструмент и короткое описание действия без секретов.
export interface ConfirmRequest {
  id: string;
  connection: string;   // имя подключения-источника
  tool: string;         // имя инструмента
  action: string;       // краткое описание действия с аргументами, не длиннее 300 знаков
  text: string;         // готовая строка вопроса для окон
}

export interface ToolRegistry {
  register(def: ToolDef, handler: ToolHandler): void;
  unregisterSource(source: ToolDef['source']): void;
  list(): ToolDef[];
  call(name: string, args: Record<string, unknown>, opts?: ToolCallOptions): Promise<ToolResult>;
}

export type Mood = 'neutral' | 'happy' | 'confused';

// Смена эмоции внутри реплики: at — позиция в знаках очищенного текста say.
export interface MoodMark {
  at: number;
  mood: string;
}

// Как пришла реплика человека: голосом или набранным текстом.
export type InputSource = 'voice' | 'text';

// Режим ответа Тишки: вслух и текстом или только текстом.
export type SpeechMode = 'voice' | 'text';

export type Panel =
  | { kind: 'list'; title: string; items: { title: string; subtitle?: string; url?: string }[] }
  | { kind: 'text'; title: string; markdown: string }
  | { kind: 'image'; title: string; path: string };

export interface Reply {
  say: string;      // вслух: до двух коротких предложений, без цифр и латиницы
  show?: Panel;     // подробности в панели и в чате
  ask?: { title: string; placeholder?: string };   // просьба прислать текст: окно показывает карточку ввода
  mood?: Mood;
  moods?: MoodMark[];   // эмоции, отмеченные метками [имя] внутри say
}

// Вид выполненного дела в счётчике: навык, сработавшая автоматизация,
// черновик письма, найденная страница, событие календаря, напоминание.
export type DeedKind = 'skill' | 'automation' | 'draft' | 'page' | 'event' | 'reminder';

export interface Deed {
  id: string;
  kind: DeedKind;
  title: string;
  at: string;                 // ISO момента выполнения
  minutes: number;            // сколько минут это заняло бы руками
  durationMs?: number;        // сколько заняло у Тишки
  steps?: number;             // сколько шагов в навыке
  skillId?: string;
}

export interface StatsPeriod {
  deeds: number;
  minutes: number;
}

export interface StatsSummary {
  today: StatsPeriod;
  week: StatsPeriod;
  total: StatsPeriod;
  bySkill: { skillId: string; name: string; deeds: number; minutes: number }[];
  byWeekday: StatsPeriod[];   // текущая неделя, 0 — понедельник … 6 — воскресенье
  recent: Deed[];             // последние дела, новые первыми
}

export type TishkaEvent =
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
  | { type: 'confirm.request'; id: string; connection: string; tool: string; action: string; text: string }
  | { type: 'confirm.close'; id: string }   // вопрос снят: ответ человека, отказ или остановка
  | { type: 'skill.saved'; skillId: string; source?: 'dialog' | 'screen' }   // 'dialog' — сохранён в разговоре, 'screen' — на экране автоматизаций
  | { type: 'memory.changed' }
  | { type: 'calendar.changed' }
  | { type: 'skill.removed'; skillId: string }
  | { type: 'stats.changed' }   // счётчик выполненных дел изменился
  | { type: 'error'; message: string }
  | { type: 'idle' };

export interface EventBus {
  emit(event: TishkaEvent): void;
  on(listener: (event: TishkaEvent) => void): () => void;   // возвращает отписку
}

export interface Skill {
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

export type Trigger =
  | { type: 'manual' }
  | { type: 'schedule'; at?: string; cron?: string }          // at — ISO-время разового запуска
  | { type: 'watch'; tool: string; args: Record<string, unknown>; everyMinutes: number; field?: string };

export interface SkillInput { name: string; description: string; required: boolean; default?: unknown }

export type Step =
  | { id: string; tool: string; args: Record<string, unknown> }   // вызов инструмента
  | { id: string; ask: string }                                   // запрос к модели, результат — текст
  | { id: string; say: string; show?: Panel };                    // реплика пользователю

export interface SecretStore {
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | undefined>;   // только главный процесс
  has(name: string): Promise<boolean>;
  delete(name: string): Promise<void>;
  names(): Promise<string[]>;
}

export interface Config {
  llm: { baseUrl: string; model: string; visionModel: string; fallbackModel: string; visionFallbackModel: string; api: 'chat' | 'responses' };   // fallbackModel/visionFallbackModel — запасные модели на случай отказа основных; api — формат запросов к шлюзу: 'chat' (по умолчанию, /chat/completions) или 'responses' (/responses)
  voice: {
    hotkey: string;
    wakeWords: string[];
    wakeEnabled: boolean;                // откликаться на имя
    talkByDefault: boolean;              // включать разговор при появлении по обращению
    talkTimeoutSec: number;              // выключить микрофон по тишине в режиме разговора
    idleLeaveSec: number;                // уйти с экрана после простоя вне разговора
    sensitivity: 'low' | 'normal' | 'high';   // осталось для совместимости, на порог не влияет
    mic: { threshold: number | null; noise: number | null; speech: number | null; calibratedAt: string | null };   // порог громкости и результат калибровки; threshold null — порог по умолчанию
    sttUrl: string;                      // адрес службы распознавания
    stt: { exe: string; model: string; audioCtx: number; threads: number; mode: 'local' | 'remote' };   // local — запускать службу на этом компьютере; remote — готовая служба по sttUrl; пустой exe — не запускать
    tts: { enabled: boolean; url: string; volume: number; bySentence: boolean };   // синтез речи: говорить вслух; bySentence — начинать по предложениям, не дожидаясь всей реплики
  };
  mcpServers: McpServerConfig[];
  persona: { fyr: 'off' | 'sometimes' | 'often'; character: 'hedgehog' | 'tishka' };   // как часто Тишка говорит «фыр»; какой персонаж показывается
  calendar: CalendarConfig;   // рабочее время, напоминания календаря
  pet: { x: number | null };   // положение окна-питомца по горизонтали, null — у правого края
  petMode: boolean;
  screen: { enabled: boolean };   // разрешено ли смотреть на экран
  web: { enabled: boolean };      // разрешено ли читать страницы из интернета
  app: {
    warmMinutes: number;          // держать микрофон наготове после последнего обращения
    memoryLimitMb: number;        // предел памяти приложения вместе со службой распознавания
    autostart: boolean;           // запуск вместе с Windows свёрнутым
  };
}

export type McpServerConfig =
  | { name: string; transport: 'http'; url: string; headers?: Record<string, string>; confirmChanges?: boolean }
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      confirmChanges?: boolean;   // спрашивать человека перед меняющими инструментами; нет поля — да
    };

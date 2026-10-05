import { join } from 'node:path';
import { createAgent, type Agent } from './agent/agent';
import { defaultConfig, loadConfig, saveConfig as persistConfig } from './config';
import { createConversationClock } from './conversation';
import { createCalendarReminders, createFocusGate } from './calendar/reminders';
import { scheduleEvents } from './calendar/schedule';
import { situation, situationLine, type CalendarSituation } from './calendar/situation';
import { createCalendarStore, type CalendarStore } from './calendar/store';
import { registerCalendarTools } from './calendar/tools';
import type { AddEventInput, CalendarEvent, CalendarRange, UpdateEventPatch } from './calendar/types';
import { freeWindows } from './calendar/windows';
import { createHistory, type HistoryEntry } from './history';
import { registerHistoryTools } from './history-tool';
import { checkGateway as runGatewayCheck, type GatewayCheckResult } from './llm/check';
import { runTriggered } from './idle';
import { createLlmClient } from './llm/client';
import { createMcpManager, type McpManager, type McpStatus } from './mcp/manager';
import type { McpConnectionFactory } from './mcp/connection';
import { resolveSecrets } from './secrets/resolve';
import { createMemoryReviewer, type MemoryReviewer } from './memory/review';
import { createMemoryStore, type MemoryRecord, type MemoryStore, type UpdateMemoryPatch } from './memory/store';
import { registerMemoryTools } from './memory/tools';
import { createRouter, type Router } from './router';
import { createSkillOverview, registerOverviewTools, type SkillOverview, type SkillOverviewService } from './skills/overview';
import { installPreset, listPresets, registerPresetTools, type PresetInfo } from './skills/presets';
import { createSkillRunner, type SkillRunner } from './skills/runner';
import { createSkillStore, SkillValidationError } from './skills/store';
import { registerSkillTools, stepTools } from './skills/tools';
import type { ValidationResult } from './skills/validate';
import { createScheduler, type Scheduler } from './triggers/scheduler';
import { createTriggerState } from './triggers/state';
import { registerTriggerTools } from './triggers/tools';
import { createWatcher, type Watcher } from './triggers/watcher';
import { registerBuiltinTools } from './tools/builtin';
import { createToolGroup, type ToolGroup } from './tools/group';
import { createToolRegistry } from './tools/registry';
import { registerScreenTools } from './tools/screen';
import { registerSpeechModeTool } from './tools/speech-mode';
import { registerWebTools } from './tools/web';
import type { Config, EventBus, InputSource, McpServerConfig, Panel, Reply, SecretStore, Skill, TishkaEvent } from './types';
import { isCancelled } from './cancel';
import { CANCELLED_REPLY, createTurnQueue, REPLACED_NOTE } from './turn-queue';
import { STOPPED_TITLE } from './stopped';
import type { WebReader } from './web/types';
import { createVisionLook, type CaptureResult, type ScreenTarget } from './vision/look';
import type { TimingMark } from '../main/timing-log';

export interface CoreDeps {
  dataDir: string;                 // каталог данных пользователя
  presetsDir: string;              // каталог presets/
  appRoot: string;                 // корень приложения, от него считаются относительные пути серверов MCP
  secrets: SecretStore;
  // Шина событий; необязательный emitAs позволяет пометить источник «чат» даже
  // вне хода ядра (служебные строки остановки и вытесненной реплики).
  events: EventBus & { emitAs?(source: 'chat' | 'pet', event: TishkaEvent): void };
  openExternal(url: string): Promise<void>;
  showPanel(panel: Panel): void;
  now: () => Date;
  mark?: TimingMark;               // журнал времени, необязателен в тестах
  fetch?: typeof fetch;            // для тестов
  captureScreen?(target: ScreenTarget): Promise<CaptureResult>;   // снимок экрана из главного процесса
  readWeb?: WebReader;             // чтение страниц из скрытого окна Electron
  createMcpConnection?: McpConnectionFactory;   // подключение MCP, подменяется в тестах
  stopSpeaking?(): void;           // остановить звучащую речь (инструмент speech_mode)
  voiceAvailable?(): Promise<boolean>;   // доступна ли служба синтеза
  onConfigChanged?(previous: Config, next: Config): void;   // настройки сохранены ядром
}

export type SaveSkillResult = { ok: true } | { ok: false; errors: string[] };
export type InstallPresetResult = { ok: true } | { ok: false; error: string };

export interface SkillService {
  overview(): Promise<SkillOverview[]>;
  save(skill: Skill): Promise<SaveSkillResult>;
  remove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<boolean>;
  run(id: string, inputs?: Record<string, unknown>): Promise<Reply>;
  presets(): Promise<PresetInfo[]>;
  installPreset(id: string, overwrite?: boolean): Promise<InstallPresetResult>;
  previewImport(path: string): Promise<ValidationResult>;
  export(id: string, targetPath: string): Promise<void>;
}

export interface CalendarService {
  events(range?: CalendarRange): Promise<CalendarEvent[]>;
  add(input: AddEventInput): Promise<CalendarEvent>;
  update(id: string, patch: UpdateEventPatch): Promise<CalendarEvent | undefined>;
  remove(id: string): Promise<boolean>;
  free(day: string | undefined, durationMinutes: number): Promise<{ start: string; end: string }[]>;
  situation(): CalendarSituation;
}

export interface TishkaCore {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleUserText(text: string, source?: InputSource): Promise<Reply>;
  cancel(source?: StopSource): void;   // прервать текущую работу и очистить очередь
  hasGatewayKey(): Promise<boolean>;
  checkGateway(input: { baseUrl: string; model: string; key?: string; api?: string }): Promise<GatewayCheckResult>;
  config(): Config;
  mcpStatus(): McpStatus[];
  reloadConfig(): Promise<void>;   // перечитать config.json и переподключить серверы MCP
  saveConfig(next: Config): Promise<void>;   // сохранить настройки и применить их
  reconnect(name: string): Promise<McpStatus | undefined>;   // переподключить один сервер и вернуть его статус
  skills: SkillService;
  calendar: CalendarService;
  history(limit?: number): HistoryEntry[];
  historySearch(query: string, limit?: number): HistoryEntry[];
  newConversation(): void;         // очищает контекст агента и ставит разделитель в истории
  clearHistory(): Promise<void>;
  memory(): MemoryRecord[];
  memorySearch(query: string): MemoryRecord[];
  memoryName(): string | undefined;   // текст записи с меткой «имя»
  memoryUpdate(id: string, patch: UpdateMemoryPatch): Promise<MemoryRecord | undefined>;
  memoryRemove(id: string): Promise<boolean>;
  memoryClear(): Promise<void>;
}

// Откуда пришла остановка: из окна чата строка видна только в ленте чата,
// из окна ежа — уведомлением, как раньше.
export type StopSource = 'chat' | 'pet';

const API_KEY_SECRET = 'DKS_API_KEY';
const DRIVE_PATTERN = /^[A-Za-z]:/;
const NOT_READY: Reply = { say: 'Я ещё не проснулся, дай мне мгновение', mood: 'confused' };
const NO_KEY: Reply = { say: 'Ключ шлюза не задан, добавь его в подключениях', mood: 'confused' };
const UNEXPECTED: Reply = { say: 'Что-то пошло не так, попробуй ещё раз', mood: 'confused' };

function isAbsoluteArg(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\') || DRIVE_PATTERN.test(value);
}

// Относительные пути в args считаются от appRoot, а node заменяется на встроенный
// исполняемый файл, чтобы свои серверы работали и без установленного Node.js.
function prepareMcpServer(server: McpServerConfig, appRoot: string): McpServerConfig {
  if (server.transport !== 'stdio') {
    return server;
  }
  const args = (server.args ?? []).map((arg) =>
    arg.startsWith('-') || isAbsoluteArg(arg) ? arg : join(appRoot, arg)
  );
  const env: Record<string, string> = { ...(server.env ?? {}) };
  let command = server.command;
  if (command.toLowerCase() === 'node') {
    command = process.execPath;
    env['ELECTRON_RUN_AS_NODE'] = '1';
  }
  const prepared: McpServerConfig = { name: server.name, transport: 'stdio', command, args };
  if (Object.keys(env).length > 0) {
    prepared.env = env;
  }
  return prepared;
}

export function createTishkaCore(deps: CoreDeps): TishkaCore {
  let config: Config = defaultConfig();
  let router: Router | undefined;
  let scheduler: Scheduler | undefined;
  let watcher: Watcher | undefined;
  let reviewer: MemoryReviewer | undefined;
  let memory: MemoryStore | undefined;
  let mcp: McpManager | undefined;
  let mcpApply: Promise<void> = Promise.resolve();
  const appliedMcp = new Map<string, string>();   // имя сервера — подпись подключения
  let agent: Agent | undefined;
  let started = false;
  let starting: Promise<void> | undefined;
  let skillStore: ReturnType<typeof createSkillStore> | undefined;
  let skillRunner: SkillRunner | undefined;
  let skillOverview: SkillOverviewService | undefined;
  let webTools: ToolGroup | undefined;
  let screenTools: ToolGroup | undefined;
  let calendarStore: CalendarStore | undefined;
  let calendarEvents: (() => Promise<CalendarEvent[]>) | undefined;
  let calendarTimer: ReturnType<typeof setInterval> | undefined;
  let stopSource: StopSource = 'pet';
  const historyStore = createHistory(join(deps.dataDir, 'history.jsonl'), deps.events, deps.now);
  const conversation = createConversationClock();
  const turns = createTurnQueue({
    run: (text, signal, source) => processUserText(text, signal, source),
    reset: () => agent?.reset(),
    onReplaced: () => emitChatStatus(REPLACED_NOTE)
  });

  // Новый разговор: чистый контекст агента плюс разделитель в ленте.
  function openConversation(at: Date): void {
    agent?.reset();
    historyStore.addDivider();
    conversation.start(at);
  }

  // Разделитель и часы разговора переключаются сразу, а контекст агента очищается
  // между ходами: иначе сброс посреди ответа оставил бы в истории висячий шаг.
  function newConversation(): void {
    historyStore.addDivider();
    conversation.start(deps.now());
    if (turns.busy()) {
      turns.resetBetweenTurns();
    } else {
      agent?.reset();
    }
  }

  // Подпись подключения: подготовленная конфигурация плюс раскрытые секреты.
  // Если она не изменилась, сервер не трогаем — перезапуск нужен только при
  // смене адреса, команды, аргументов, окружения или самого секрета.
  async function mcpSignature(server: McpServerConfig): Promise<string> {
    const prepared = prepareMcpServer(server, deps.appRoot);
    const raw = prepared.transport === 'http' ? prepared.headers : prepared.env;
    let resolved: Record<string, string> | undefined;
    if (raw !== undefined) {
      try {
        resolved = await resolveSecrets(raw, deps.secrets);
      } catch {
        resolved = raw;
      }
    }
    return JSON.stringify({ prepared, resolved });
  }

  async function applyMcpServers(servers: McpServerConfig[]): Promise<void> {
    if (mcp === undefined || router === undefined) {
      return;
    }
    const wanted = new Set(servers.map((server) => server.name));
    for (const status of mcp.status()) {
      if (!wanted.has(status.name)) {
        await mcp.disconnect(status.name);
        appliedMcp.delete(status.name);
      }
    }
    let changed = false;
    for (const server of servers) {
      const signature = await mcpSignature(server);
      if (appliedMcp.get(server.name) === signature) {
        continue;
      }
      await mcp.reconnect(prepareMcpServer(server, deps.appRoot));
      appliedMcp.set(server.name, signature);
      changed = true;
    }
    if (changed) {
      await router.refreshSkills();
    }
  }

  // Применения настроек идут строго по очереди: сохранение, случившееся во время
  // стартового подключения, должно видеть уже применённые подписи серверов.
  function scheduleMcpServers(servers: McpServerConfig[]): Promise<void> {
    const run = mcpApply.then(() => applyMcpServers(servers));
    mcpApply = run.catch(() => undefined);
    return run;
  }

  async function scrubMessage(message: string): Promise<string> {
    let result = message;
    for (const name of await deps.secrets.names()) {
      const value = await deps.secrets.get(name);
      if (value !== undefined && value !== '') {
        result = result.split(value).join('***');
      }
    }
    return result;
  }

  // Ключ шлюза: секрет DKS_API_KEY, при его отсутствии — переменная окружения.
  async function gatewayKey(): Promise<string | undefined> {
    const stored = await deps.secrets.get(API_KEY_SECRET);
    if (stored !== undefined && stored.length > 0) {
      return stored;
    }
    const fromEnv = process.env[API_KEY_SECRET];
    return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : undefined;
  }

  async function hasGatewayKey(): Promise<boolean> {
    return (await gatewayKey()) !== undefined;
  }

  // Проверка шлюза не сохраняет настройки. Ключ из поля важнее сохранённого.
  async function checkGateway(input: {
    baseUrl: string;
    model: string;
    key?: string;
    api?: string;
  }): Promise<GatewayCheckResult> {
    const explicit = typeof input.key === 'string' ? input.key.trim() : '';
    const apiKey = explicit !== '' ? explicit : await gatewayKey();
    if (apiKey === undefined) {
      return { ok: false, models: [], error: 'Ключ шлюза не задан', ms: 0 };
    }
    return runGatewayCheck(
      {
        baseUrl: input.baseUrl,
        model: input.model,
        apiKey,
        api: input.api === 'responses' ? 'responses' : 'chat'
      },
      { fetch: deps.fetch }
    );
  }

  // Служебная строка живёт только в ленте чата: помечаем источник «чат», чтобы
  // ёж её не показывал. Без пометки (в тестах) шлём обычным событием статуса.
  function emitChatStatus(text: string): void {
    if (deps.events.emitAs !== undefined) {
      deps.events.emitAs('chat', { type: 'status', text });
      return;
    }
    deps.events.emit({ type: 'status', text });
  }

  // Строка остановки: из окна чата — событие статуса, которое ёж не показывает,
  // скрытого ежа оно не поднимает; из окна ежа — уведомление, как раньше.
  function emitStopped(): void {
    if (stopSource === 'chat') {
      emitChatStatus(STOPPED_TITLE);
      return;
    }
    deps.events.emit({ type: 'notify', title: STOPPED_TITLE });
  }

  async function processUserText(text: string, signal: AbortSignal, source: InputSource): Promise<Reply> {
    const now = deps.now();
    if (conversation.userTurn(now)) {
      openConversation(now);
    }
    deps.events.emit({ type: 'listen.end', text });
    let reply: Reply;
    try {
      if (router === undefined) {
        reply = NOT_READY;
      } else if ((await gatewayKey()) === undefined) {
        reply = NO_KEY;
      } else {
        reply = await router.handle(text, { signal, source });
      }
    } catch (error) {
      if (isCancelled(error, signal)) {
        emitStopped();
        deps.events.emit({ type: 'idle' });
        return CANCELLED_REPLY;
      }
      const raw = error instanceof Error ? error.message : String(error);
      const message = await scrubMessage(raw);
      deps.events.emit({ type: 'error', message });
      reply = UNEXPECTED;
    }
    deps.events.emit({ type: 'idle' });
    return reply;
  }

  function handleUserText(text: string, source: InputSource = 'text'): Promise<Reply> {
    if (!started) {
      return Promise.resolve(NOT_READY);
    }
    return turns.push(text, source);
  }

  // Остановка текущей работы: ход прерывается сигналом в запросах, очередь
  // очищается, окна получают событие простоя. Источник решает, как окна
  // показывают служебную строку.
  function cancel(source?: StopSource): void {
    stopSource = source ?? 'pet';
    if (!turns.cancel()) {
      deps.events.emit({ type: 'idle' });
      return;
    }
    if (turns.busy()) {
      // Выполняющийся ход завершится сам и пришлёт «Остановлено» с простоем.
      return;
    }
    emitStopped();
    deps.events.emit({ type: 'idle' });
  }

  async function start(): Promise<void> {
    if (started) {
      return;
    }
    if (starting !== undefined) {
      return starting;
    }
    starting = runStart();
    try {
      await starting;
    } finally {
      starting = undefined;
    }
  }

  async function runStart(): Promise<void> {
    const stepError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

    config = await loadConfig(deps.dataDir);

    // История — необязательный шаг: без неё ядро продолжает работать.
    try {
      historyStore.stop();
      await historyStore.start();
    } catch (error) {
      deps.events.emit({ type: 'error', message: `Не удалось открыть историю: ${stepError(error)}` });
    }

    const skills = createSkillStore(join(deps.dataDir, 'skills'));
    skillStore = skills;
    // Пресеты — тоже необязательный шаг: сбой одного файла не мешает старту.
    try {
      await skills.loadPresets(deps.presetsDir);
    } catch (error) {
      deps.events.emit({ type: 'error', message: `Не удалось загрузить пресеты: ${stepError(error)}` });
    }

    const registry = createToolRegistry(deps.events);
    registerBuiltinTools(registry, {
      openExternal: deps.openExternal,
      showPanel: deps.showPanel,
      now: deps.now
    });
    registerHistoryTools(registry, historyStore);
    registerSpeechModeTool(registry, {
      setEnabled: async (enabled) => {
        await saveConfig({ ...config, voice: { ...config.voice, tts: { ...config.voice.tts, enabled } } });
      },
      stopSpeaking: deps.stopSpeaking ?? (() => undefined),
      voiceAvailable: deps.voiceAvailable ?? (async () => true)
    });
    const webGroup = createToolGroup(registry, (target) =>
      registerWebTools(target, { read: deps.readWeb, fetch: deps.fetch }, true)
    );
    webTools = webGroup;
    webGroup.setEnabled(config.web.enabled);

    const memoryStore = createMemoryStore({
      filePath: join(deps.dataDir, 'memory.json'),
      now: deps.now
    });
    await memoryStore.load();
    memory = memoryStore;
    registerMemoryTools(registry, memoryStore, deps.events);

    const calendar = createCalendarStore({
      filePath: join(deps.dataDir, 'calendar.json'),
      now: deps.now,
      mark: deps.mark
    });
    await calendar.load();
    calendarStore = calendar;
    // Во время события focus уведомления навыков и слежения копятся и
    // показываются приглушённой строкой после его конца.
    const gate = createFocusGate({
      bus: deps.events,
      isFocusActive: () => {
        const nowMs = deps.now().getTime();
        return calendar
          .all()
          .some((event) => event.kind === 'focus' && Date.parse(event.start) <= nowMs && nowMs < Date.parse(event.end));
      }
    });

    // Запасная модель для запрошенной: у модели картинок своя настройка.
    const fallbackFor = (model: string): string | undefined => {
      const vision = config.llm.visionModel.trim();
      if (vision !== '' && model === vision) {
        return config.llm.visionFallbackModel.trim() || undefined;
      }
      if (model === config.llm.model.trim()) {
        return config.llm.fallbackModel.trim() || undefined;
      }
      return undefined;
    };

    const llm = createLlmClient({
      baseUrl: () => config.llm.baseUrl,
      getApiKey: gatewayKey,
      api: () => config.llm.api,
      fetch: deps.fetch,
      fallbackModel: fallbackFor,
      onFallback: ({ from, to }) => {
        deps.events.emit({ type: 'note', text: `Модель ${from} не отвечает, работаю на ${to}` });
      },
      mark: deps.mark
    });

    const capture = deps.captureScreen;
    if (capture !== undefined) {
      const visionLook = createVisionLook({
        capture,
        chat: (req) => llm.chat(req),
        visionModel: () => config.llm.visionModel
      });
      const screenGroup = createToolGroup(registry, (target) =>
        registerScreenTools(
          target,
          {
            capture,
            look: (question, screenTarget, opts) => visionLook.look(question, screenTarget, opts),
            screenshotsDir: join(deps.dataDir, 'screenshots'),
            now: deps.now,
            events: deps.events
          },
          true
        )
      );
      screenTools = screenGroup;
      screenGroup.setEnabled(config.screen.enabled);
    }

    const runner = createSkillRunner({
      registry,
      ask: async (prompt) => {
        const response = await llm.chat({
          model: config.llm.model,
          messages: [{ role: 'user', content: prompt }]
        });
        return response.text ?? '';
      },
      events: deps.events,
      now: deps.now
    });
    skillRunner = runner;

    const state = createTriggerState(join(deps.dataDir, 'triggers.json'));
    scheduler = createScheduler({ skills, runner, state, events: gate, now: deps.now });
    watcher = createWatcher({ skills, registry, runner, state, events: gate, now: deps.now });
    registerTriggerTools(registry, scheduler, deps.now);

    calendarEvents = async () => {
      const skillList = await skills.list();
      return [...calendar.all(), ...scheduleEvents(await state.load(), skillList)];
    };
    registerCalendarTools(registry, {
      store: calendar,
      provider: () => calendarEvents?.() ?? Promise.resolve([]),
      config: () => config.calendar,
      now: deps.now,
      emitChanged: () => deps.events.emit({ type: 'calendar.changed' })
    });
    registerSkillTools(registry, { store: skills, registry, events: deps.events });
    registerPresetTools(registry, { presetsDir: deps.presetsDir, store: skills, events: deps.events });
    const overview = createSkillOverview({ store: skills, state, tools: () => stepTools(registry) });
    skillOverview = overview;
    registerOverviewTools(registry, overview);

    agent = createAgent({
      llm,
      registry,
      events: deps.events,
      getModel: () => config.llm.model,
      getPersona: () => config.persona,
      getSpeechMode: () => (config.voice.tts.enabled ? 'voice' : 'text'),
      memory: { search: (query, limit) => memoryStore.search(query, limit) },
      situation: () => situationLine(situation(calendar.all(), config.calendar, deps.now()), deps.now()),
      now: deps.now,
      mark: deps.mark
    });
    router = createRouter({ agent, skills, runner, registry, events: deps.events });
    await router.refreshSkills();

    // Запуск приложения начинает новый разговор: старый контекст в модель не уходит.
    openConversation(deps.now());

    const reminders = createCalendarReminders({
      events: () => calendarEvents?.() ?? Promise.resolve([]),
      now: deps.now,
      bus: gate,
      config: () => config.calendar,
      flush: () => gate.flush()
    });
    reviewer = createMemoryReviewer({ store: memoryStore, events: gate, now: deps.now });
    await scheduler.start();
    await watcher.start();
    await reviewer.start();
    await reminders.tick();
    if (calendarTimer === undefined) {
      calendarTimer = setInterval(() => {
        void reminders.tick();
      }, 30_000);
    }

    // Подключение серверов MCP не задерживает запуск: идёт в фоне.
    mcp = createMcpManager({
      registry,
      secrets: deps.secrets,
      mark: deps.mark,
      createConnection: deps.createMcpConnection
    });
    void scheduleMcpServers(config.mcpServers).catch(() => undefined);

    // Ядро считается проснувшимся, только когда все обязательные шаги прошли:
    // при сбое повторный start() выполнится заново.
    started = true;
  }

  async function stop(): Promise<void> {
    historyStore.stop();
    scheduler?.stop();
    watcher?.stop();
    reviewer?.stop();
    if (calendarTimer !== undefined) {
      clearInterval(calendarTimer);
      calendarTimer = undefined;
    }
    await mcpApply.catch(() => undefined);
    await mcp?.closeAll();
  }

  async function reloadConfig(): Promise<void> {
    const previous = config;
    config = await loadConfig(deps.dataDir);
    if (!started) {
      return;
    }
    // Группы инструментов пересобираются только при смене своей настройки:
    // сохранение голоса, характера или окна их не трогает.
    if (previous.web.enabled !== config.web.enabled) {
      webTools?.setEnabled(config.web.enabled);
    }
    if (previous.screen.enabled !== config.screen.enabled) {
      screenTools?.setEnabled(config.screen.enabled);
    }
    await scheduleMcpServers(config.mcpServers);
  }

  async function saveConfig(next: Config): Promise<void> {
    const previous = config;
    await persistConfig(deps.dataDir, next);
    await reloadConfig();
    deps.onConfigChanged?.(previous, config);
  }

  async function reconnect(name: string): Promise<McpStatus | undefined> {
    if (mcp === undefined) {
      return undefined;
    }
    const server = config.mcpServers.find((item) => item.name === name);
    if (server === undefined) {
      return undefined;
    }
    const status = await mcp.reconnect(prepareMcpServer(server, deps.appRoot));
    await router?.refreshSkills();
    return status;
  }

  const skillService: SkillService = {
    async overview(): Promise<SkillOverview[]> {
      return skillOverview === undefined ? [] : skillOverview.list();
    },

    async save(skill: Skill): Promise<SaveSkillResult> {
      if (skillStore === undefined) {
        return { ok: false, errors: ['Ядро не запущено'] };
      }
      try {
        await skillStore.save(skill);
      } catch (error) {
        if (error instanceof SkillValidationError) {
          return { ok: false, errors: error.errors };
        }
        throw error;
      }
      deps.events.emit({ type: 'skill.saved', skillId: skill.id, source: 'screen' });
      return { ok: true };
    },

    async remove(id: string): Promise<boolean> {
      if (skillStore === undefined) {
        return false;
      }
      await skillStore.remove(id);
      deps.events.emit({ type: 'skill.removed', skillId: id });
      return true;
    },

    async setEnabled(id: string, enabled: boolean): Promise<boolean> {
      if (skillStore === undefined) {
        return false;
      }
      const skill = await skillStore.get(id);
      if (skill === undefined) {
        return false;
      }
      await skillStore.save({ ...skill, enabled });
      deps.events.emit({ type: 'skill.saved', skillId: id, source: 'screen' });
      return true;
    },

    async run(id: string, inputs?: Record<string, unknown>): Promise<Reply> {
      const runner = skillRunner;
      if (runner === undefined || skillStore === undefined) {
        return NOT_READY;
      }
      const skill = await skillStore.get(id);
      if (skill === undefined) {
        return { say: 'Навык не найден', mood: 'confused' };
      }
      const result = await runTriggered(deps.events, async () => {
        deps.events.emit({ type: 'wake', source: 'trigger' });
        return runner.run(skill, inputs);
      });
      if (result.ok) {
        return result.reply ?? { say: 'Готово!' };
      }
      return { say: result.error ?? 'Не получилось выполнить навык', mood: 'confused' };
    },

    async presets(): Promise<PresetInfo[]> {
      if (skillStore === undefined) {
        return [];
      }
      return listPresets(deps.presetsDir, skillStore);
    },

    async installPreset(id: string, overwrite?: boolean): Promise<InstallPresetResult> {
      if (skillStore === undefined) {
        return { ok: false, error: 'Ядро не запущено' };
      }
      const result = await installPreset(deps.presetsDir, id, skillStore, { overwrite: overwrite === true });
      if (result.ok) {
        deps.events.emit({ type: 'skill.saved', skillId: id, source: 'screen' });
      }
      return result;
    },

    async previewImport(path: string): Promise<ValidationResult> {
      if (skillStore === undefined) {
        return { ok: false, errors: ['Ядро не запущено'] };
      }
      return skillStore.previewFile(path);
    },

    async export(id: string, targetPath: string): Promise<void> {
      if (skillStore === undefined) {
        throw new Error('Ядро не запущено');
      }
      await skillStore.exportFile(id, targetPath);
    }
  };

  const calendarService: CalendarService = {
    async events(range?: CalendarRange): Promise<CalendarEvent[]> {
      const list = calendarEvents === undefined ? [] : await calendarEvents();
      if (range?.from === undefined || range.to === undefined) {
        return [...list].sort((a, b) => a.start.localeCompare(b.start));
      }
      const from = Date.parse(range.from);
      const to = Date.parse(range.to);
      return list
        .filter((event) => {
          const start = Date.parse(event.start);
          const end = Date.parse(event.end);
          return !Number.isNaN(start) && !Number.isNaN(end) && start < to && end > from;
        })
        .sort((a, b) => a.start.localeCompare(b.start));
    },

    async add(input: AddEventInput): Promise<CalendarEvent> {
      if (calendarStore === undefined) {
        throw new Error('Ядро не запущено');
      }
      const event = await calendarStore.add(input);
      deps.events.emit({ type: 'calendar.changed' });
      return event;
    },

    async update(id: string, patch: UpdateEventPatch): Promise<CalendarEvent | undefined> {
      if (calendarStore === undefined) {
        return undefined;
      }
      const event = await calendarStore.update(id, patch);
      if (event !== undefined) {
        deps.events.emit({ type: 'calendar.changed' });
      }
      return event;
    },

    async remove(id: string): Promise<boolean> {
      if (calendarStore === undefined) {
        return false;
      }
      const removed = await calendarStore.remove(id);
      if (removed) {
        deps.events.emit({ type: 'calendar.changed' });
      }
      return removed;
    },

    async free(day: string | undefined, durationMinutes: number): Promise<{ start: string; end: string }[]> {
      if (calendarStore === undefined) {
        return [];
      }
      const date = day === undefined ? deps.now() : new Date(day);
      if (Number.isNaN(date.getTime())) {
        return [];
      }
      const list = calendarEvents === undefined ? [] : await calendarEvents();
      return freeWindows(list, config.calendar, date, durationMinutes);
    },

    situation(): CalendarSituation {
      return situation(calendarStore?.all() ?? [], config.calendar, deps.now());
    }
  };

  return {
    start,
    stop,
    handleUserText,
    cancel,
    hasGatewayKey,
    checkGateway,
    config: () => config,
    mcpStatus: () => mcp?.status() ?? [],
    reloadConfig,
    saveConfig,
    reconnect,
    skills: skillService,
    calendar: calendarService,
    history: (limit?: number) => historyStore.list(limit),
    historySearch: (query: string, limit?: number) => historyStore.search(query, limit),
    newConversation,
    clearHistory: () => historyStore.clear(),
    memory: () => memory?.list() ?? [],
    memorySearch: (query: string) => memory?.search(query) ?? [],
    memoryName: () =>
      memory?.list().find((record) => record.tags.some((tag) => tag.trim().toLowerCase() === 'имя'))?.text,
    memoryUpdate: async (id: string, patch: UpdateMemoryPatch) => {
      const record = memory === undefined ? undefined : await memory.update(id, patch);
      if (record !== undefined) {
        deps.events.emit({ type: 'memory.changed' });
      }
      return record;
    },
    memoryRemove: async (id: string) => {
      const removed = memory === undefined ? false : await memory.remove(id);
      if (removed) {
        deps.events.emit({ type: 'memory.changed' });
      }
      return removed;
    },
    memoryClear: async () => {
      if (memory !== undefined) {
        await memory.clear();
        deps.events.emit({ type: 'memory.changed' });
      }
    }
  };
}

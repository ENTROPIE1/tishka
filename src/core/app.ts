import { join } from 'node:path';
import { createAgent } from './agent/agent';
import { defaultConfig, loadConfig, saveConfig as persistConfig } from './config';
import { createHistory, type HistoryEntry } from './history';
import { createLlmClient } from './llm/client';
import { createMcpManager, type McpManager, type McpStatus } from './mcp/manager';
import { createMemoryReviewer, type MemoryReviewer } from './memory/review';
import { createMemoryStore, type MemoryRecord, type MemoryStore, type UpdateMemoryPatch } from './memory/store';
import { registerMemoryTools } from './memory/tools';
import { createRouter, type Router } from './router';
import { createSkillRunner } from './skills/runner';
import { createSkillStore } from './skills/store';
import { registerSkillTools } from './skills/tools';
import { createScheduler, type Scheduler } from './triggers/scheduler';
import { createTriggerState } from './triggers/state';
import { registerTriggerTools } from './triggers/tools';
import { createWatcher, type Watcher } from './triggers/watcher';
import { registerBuiltinTools } from './tools/builtin';
import { createToolRegistry } from './tools/registry';
import type { Config, EventBus, McpServerConfig, Panel, Reply, SecretStore } from './types';

export interface CoreDeps {
  dataDir: string;                 // каталог данных пользователя
  presetsDir: string;              // каталог presets/
  appRoot: string;                 // корень приложения, от него считаются относительные пути серверов MCP
  secrets: SecretStore;
  events: EventBus;
  openExternal(url: string): Promise<void>;
  showPanel(panel: Panel): void;
  now: () => Date;
  fetch?: typeof fetch;            // для тестов
}

export interface TishkaCore {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleUserText(text: string): Promise<Reply>;
  hasGatewayKey(): Promise<boolean>;
  config(): Config;
  mcpStatus(): McpStatus[];
  reloadConfig(): Promise<void>;   // перечитать config.json и переподключить серверы MCP
  saveConfig(next: Config): Promise<void>;   // сохранить настройки и применить их
  reconnect(name: string): Promise<McpStatus | undefined>;   // переподключить один сервер и вернуть его статус
  history(limit?: number): HistoryEntry[];
  clearHistory(): Promise<void>;
  memory(): MemoryRecord[];
  memorySearch(query: string): MemoryRecord[];
  memoryUpdate(id: string, patch: UpdateMemoryPatch): Promise<MemoryRecord | undefined>;
  memoryRemove(id: string): Promise<boolean>;
  memoryClear(): Promise<void>;
}

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
  let mcpTask: Promise<void> | undefined;
  let started = false;
  let queue: Promise<unknown> = Promise.resolve();
  const historyStore = createHistory(join(deps.dataDir, 'history.jsonl'), deps.events, deps.now);

  async function applyMcpServers(servers: McpServerConfig[]): Promise<void> {
    if (mcp === undefined || router === undefined) {
      return;
    }
    const wanted = new Set(servers.map((server) => server.name));
    for (const status of mcp.status()) {
      if (!wanted.has(status.name)) {
        await mcp.disconnect(status.name);
      }
    }
    for (const server of servers) {
      await mcp.reconnect(prepareMcpServer(server, deps.appRoot));
      await router.refreshSkills();
    }
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

  async function processUserText(text: string): Promise<Reply> {
    deps.events.emit({ type: 'listen.end', text });
    let reply: Reply;
    try {
      if (router === undefined) {
        reply = NOT_READY;
      } else if ((await gatewayKey()) === undefined) {
        reply = NO_KEY;
      } else {
        reply = await router.handle(text);
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = await scrubMessage(raw);
      deps.events.emit({ type: 'error', message });
      reply = UNEXPECTED;
    }
    deps.events.emit({ type: 'idle' });
    return reply;
  }

  function handleUserText(text: string): Promise<Reply> {
    if (!started) {
      return Promise.resolve(NOT_READY);
    }
    const task = queue.then(() => processUserText(text));
    queue = task.catch(() => undefined);
    return task;
  }

  async function start(): Promise<void> {
    if (started) {
      return;
    }
    started = true;

    config = await loadConfig(deps.dataDir);
    await historyStore.start();

    const skills = createSkillStore(join(deps.dataDir, 'skills'));
    await skills.loadPresets(deps.presetsDir);

    const registry = createToolRegistry(deps.events);
    registerBuiltinTools(registry, {
      openExternal: deps.openExternal,
      showPanel: deps.showPanel,
      now: deps.now
    });

    const memoryStore = createMemoryStore({
      filePath: join(deps.dataDir, 'memory.json'),
      now: deps.now
    });
    await memoryStore.load();
    memory = memoryStore;
    registerMemoryTools(registry, memoryStore);

    const llm = createLlmClient({
      baseUrl: config.llm.baseUrl,
      getApiKey: gatewayKey,
      fetch: deps.fetch
    });
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

    const state = createTriggerState(join(deps.dataDir, 'triggers.json'));
    scheduler = createScheduler({ skills, runner, state, events: deps.events, now: deps.now });
    watcher = createWatcher({ skills, registry, runner, state, events: deps.events, now: deps.now });
    registerTriggerTools(registry, scheduler, deps.now);
    registerSkillTools(registry, { store: skills, registry, events: deps.events });

    const agent = createAgent({
      llm,
      registry,
      events: deps.events,
      getModel: () => config.llm.model,
      getPersona: () => config.persona,
      memory: { search: (query, limit) => memoryStore.search(query, limit) },
      now: deps.now
    });
    router = createRouter({ agent, skills, runner, registry, events: deps.events });
    await router.refreshSkills();

    reviewer = createMemoryReviewer({ store: memoryStore, events: deps.events, now: deps.now });
    await scheduler.start();
    await watcher.start();
    await reviewer.start();

    // Подключение серверов MCP не задерживает запуск: идёт в фоне.
    mcp = createMcpManager({ registry, secrets: deps.secrets });
    mcpTask = applyMcpServers(config.mcpServers).catch(() => undefined);
  }

  async function stop(): Promise<void> {
    historyStore.stop();
    scheduler?.stop();
    watcher?.stop();
    reviewer?.stop();
    const task = mcpTask;
    mcpTask = undefined;
    if (task !== undefined) {
      await task;
    }
    await mcp?.closeAll();
  }

  async function reloadConfig(): Promise<void> {
    config = await loadConfig(deps.dataDir);
    if (started) {
      await applyMcpServers(config.mcpServers);
    }
  }

  async function saveConfig(next: Config): Promise<void> {
    await persistConfig(deps.dataDir, next);
    await reloadConfig();
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

  return {
    start,
    stop,
    handleUserText,
    hasGatewayKey,
    config: () => config,
    mcpStatus: () => mcp?.status() ?? [],
    reloadConfig,
    saveConfig,
    reconnect,
    history: (limit?: number) => historyStore.list(limit),
    clearHistory: () => historyStore.clear(),
    memory: () => memory?.list() ?? [],
    memorySearch: (query: string) => memory?.search(query) ?? [],
    memoryUpdate: (id: string, patch: UpdateMemoryPatch) =>
      memory === undefined ? Promise.resolve(undefined) : memory.update(id, patch),
    memoryRemove: (id: string) =>
      memory === undefined ? Promise.resolve(false) : memory.remove(id),
    memoryClear: () => (memory === undefined ? Promise.resolve() : memory.clear())
  };
}

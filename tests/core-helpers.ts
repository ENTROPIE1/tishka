import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { createTishkaCore, type CoreDeps, type TishkaCore } from '../src/core/app';
import { createEventBus } from '../src/core/events';
import type { EventBus, SecretStore, TishkaEvent } from '../src/core/types';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const presetsDir = join(root, 'presets');
export const FIXED_NOW = new Date('2026-10-02T10:00:00');

const cores: TishkaCore[] = [];
const dirs: string[] = [];

// Временный каталог, который уберёт cleanupCores: удаление с повторами не
// роняет тест, если на Windows каталог ещё занят записью.
export async function tempDir(prefix = 'tishka-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

// Свой каталог данных на каждый тест, ядро останавливаем до удаления, а удаление
// повторяем: на Windows каталог иногда занят ещё не завершённой записью.
export async function cleanupCores(): Promise<void> {
  while (cores.length > 0) {
    await cores.pop()?.stop();
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir === undefined) {
      continue;
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
}

export function fakeSecrets(values: Record<string, string> = { DKS_API_KEY: 'test-key' }): SecretStore {
  const map = new Map(Object.entries(values));
  return {
    async set(name, value) {
      map.set(name, value);
    },
    async get(name) {
      return map.get(name);
    },
    async has(name) {
      return map.has(name);
    },
    async delete(name) {
      map.delete(name);
    },
    async names() {
      return [...map.keys()];
    }
  };
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function choice(message: Record<string, unknown>): Response {
  return jsonResponse({ choices: [{ message }] });
}

export function replyChoice(id: string, say: string): Response {
  return choice({
    content: null,
    tool_calls: [{ id, type: 'function', function: { name: 'reply', arguments: JSON.stringify({ say }) } }]
  });
}

export function toolChoice(id: string, name: string, args: Record<string, unknown>): Response {
  return choice({
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  });
}

export interface CoreSetupOptions {
  fetch?: typeof fetch;
  secrets?: Record<string, string>;
  config?: unknown;
  now?: () => Date;
  captureScreen?: CoreDeps['captureScreen'];
  readWeb?: CoreDeps['readWeb'];
  stopSpeaking?: CoreDeps['stopSpeaking'];
  voiceAvailable?: CoreDeps['voiceAvailable'];
  onConfigChanged?: CoreDeps['onConfigChanged'];
}

export interface CoreHandle {
  core: TishkaCore;
  bus: EventBus;
  events: TishkaEvent[];
  openExternal: ReturnType<typeof vi.fn>;
  dataDir: string;
}

export async function setupCore(options: CoreSetupOptions = {}): Promise<CoreHandle> {
  const dataDir = await tempDir('tishka-core-');
  if (options.config !== undefined) {
    await writeFile(join(dataDir, 'config.json'), JSON.stringify(options.config), 'utf8');
  }

  const bus = createEventBus();
  const events: TishkaEvent[] = [];
  bus.on((event) => events.push(event));
  const openExternal = vi.fn(async () => undefined);

  const core = createTishkaCore({
    dataDir,
    presetsDir,
    appRoot: root,
    secrets: fakeSecrets(options.secrets ?? { DKS_API_KEY: 'test-key' }),
    events: bus,
    openExternal,
    showPanel: () => undefined,
    now: options.now ?? (() => FIXED_NOW),
    fetch: options.fetch,
    captureScreen: options.captureScreen,
    readWeb: options.readWeb,
    stopSpeaking: options.stopSpeaking,
    voiceAvailable: options.voiceAvailable,
    onConfigChanged: options.onConfigChanged
  });
  cores.push(core);
  await core.start();
  return { core, bus, events, openExternal, dataDir };
}

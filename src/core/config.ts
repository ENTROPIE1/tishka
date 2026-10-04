import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config, McpServerConfig } from './types';

export const CONFIG_FILE = 'config.json';

type TtsEngine = Config['voice']['ttsEngine'];
type FyrLevel = Config['persona']['fyr'];
type Sensitivity = Config['voice']['sensitivity'];

export function defaultConfig(): Config {
  return {
    llm: {
      baseUrl: 'https://llm.dks.lanit.ru/v1',
      model: 'DKS-Lynx',
      visionModel: 'DKS-Vision'
    },
    voice: {
      hotkey: 'Control+Alt+Space',
      wakeWords: ['тишка'],
      wakeEnabled: false,
      talkTimeoutSec: 30,
      sensitivity: 'normal',
      sttUrl: 'http://127.0.0.1:8178',
      stt: { exe: '', model: '', audioCtx: 768, threads: 4 },
      ttsEngine: 'none'
    },
    mcpServers: [],
    persona: { fyr: 'sometimes' },
    pet: { x: null },
    petMode: false
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return fallback;
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickTtsEngine(value: unknown, fallback: TtsEngine): TtsEngine {
  return value === 'piper' || value === 'silero' || value === 'none' ? value : fallback;
}

function pickFyr(value: unknown, fallback: FyrLevel): FyrLevel {
  return value === 'off' || value === 'sometimes' || value === 'often' ? value : fallback;
}

function pickSensitivity(value: unknown, fallback: Sensitivity): Sensitivity {
  return value === 'low' || value === 'normal' || value === 'high' ? value : fallback;
}

function pickPetX(value: unknown, fallback: number | null): number | null {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      return undefined;
    }
    result[key] = item;
  }
  return result;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return undefined;
  }
  return value;
}

function parseMcpServer(value: unknown): McpServerConfig | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return undefined;
  }
  const name = value.name;
  if (value.transport === 'http' && typeof value.url === 'string') {
    const headers = optionalStringRecord(value.headers);
    return headers === undefined
      ? { name, transport: 'http', url: value.url }
      : { name, transport: 'http', url: value.url, headers };
  }
  if (value.transport === 'stdio' && typeof value.command === 'string') {
    const server: McpServerConfig = { name, transport: 'stdio', command: value.command };
    const args = optionalStringArray(value.args);
    const env = optionalStringRecord(value.env);
    if (args !== undefined) {
      server.args = args;
    }
    if (env !== undefined) {
      server.env = env;
    }
    return server;
  }
  return undefined;
}

function parseMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const servers: McpServerConfig[] = [];
  for (const item of value) {
    const server = parseMcpServer(item);
    if (server !== undefined) {
      servers.push(server);
    }
  }
  return servers;
}

// Адрес и имена моделей шлюза очищаются от пробелов по краям при загрузке и
// сохранении настроек.
export function normalizeConfig(config: Config): Config {
  return {
    ...config,
    llm: {
      baseUrl: config.llm.baseUrl.trim(),
      model: config.llm.model.trim(),
      visionModel: config.llm.visionModel.trim()
    }
  };
}

export function mergeConfig(value: unknown): Config {
  const defaults = defaultConfig();
  if (!isRecord(value)) {
    return defaults;
  }
  const llm = isRecord(value.llm) ? value.llm : {};
  const voice = isRecord(value.voice) ? value.voice : {};
  const stt = isRecord(voice.stt) ? voice.stt : {};
  const persona = isRecord(value.persona) ? value.persona : {};
  const pet = isRecord(value.pet) ? value.pet : {};
  return normalizeConfig({
    llm: {
      baseUrl: pickString(llm.baseUrl, defaults.llm.baseUrl),
      model: pickString(llm.model, defaults.llm.model),
      visionModel: pickString(llm.visionModel, defaults.llm.visionModel)
    },
    voice: {
      hotkey: pickString(voice.hotkey, defaults.voice.hotkey),
      wakeWords: pickStringArray(voice.wakeWords, defaults.voice.wakeWords),
      wakeEnabled: pickBoolean(voice.wakeEnabled, defaults.voice.wakeEnabled),
      talkTimeoutSec: pickNumber(voice.talkTimeoutSec, defaults.voice.talkTimeoutSec),
      sensitivity: pickSensitivity(voice.sensitivity, defaults.voice.sensitivity),
      sttUrl: pickString(voice.sttUrl, defaults.voice.sttUrl),
      stt: {
        exe: pickString(stt.exe, defaults.voice.stt.exe),
        model: pickString(stt.model, defaults.voice.stt.model),
        audioCtx: pickNumber(stt.audioCtx, defaults.voice.stt.audioCtx),
        threads: pickNumber(stt.threads, defaults.voice.stt.threads)
      },
      ttsEngine: pickTtsEngine(voice.ttsEngine, defaults.voice.ttsEngine)
    },
    mcpServers: parseMcpServers(value.mcpServers),
    persona: { fyr: pickFyr(persona.fyr, defaults.persona.fyr) },
    pet: { x: pickPetX(pet.x, defaults.pet.x) },
    petMode: pickBoolean(value.petMode, defaults.petMode)
  });
}

export async function loadConfig(dir: string): Promise<Config> {
  try {
    const raw = await readFile(join(dir, CONFIG_FILE), 'utf8');
    return mergeConfig(JSON.parse(raw) as unknown);
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(dir: string, config: Config): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, CONFIG_FILE);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(normalizeConfig(config), null, 2), 'utf8');
  await rename(temporary, target);
}

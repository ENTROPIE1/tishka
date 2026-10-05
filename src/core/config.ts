import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultCalendarConfig,
  defaultWorkHours,
  WEEKDAYS,
  type CalendarDayHours,
  type CalendarWeekday,
  type CalendarWorkHours
} from './calendar/types';
import type { Config, McpServerConfig } from './types';

export const CONFIG_FILE = 'config.json';

type FyrLevel = Config['persona']['fyr'];
type CharacterKind = Config['persona']['character'];
type Sensitivity = Config['voice']['sensitivity'];
type LlmApi = Config['llm']['api'];
type SttMode = Config['voice']['stt']['mode'];

export function defaultConfig(): Config {
  return {
    llm: {
      baseUrl: 'https://llm.dks.lanit.ru/v1',
      model: 'DKS-Lynx',
      visionModel: 'DKS-Vision',
      fallbackModel: '',
      visionFallbackModel: '',
      api: 'chat'
    },
    voice: {
      hotkey: 'Control+Alt+Space',
      wakeWords: ['тишка'],
      wakeEnabled: false,
      talkByDefault: true,
      talkTimeoutSec: 30,
      sensitivity: 'normal',
      mic: { threshold: null, noise: null, speech: null, calibratedAt: null },
      sttUrl: 'http://127.0.0.1:8178',
      stt: { exe: '', model: '', audioCtx: 768, threads: 4, mode: 'remote' },
      tts: { enabled: false, url: 'http://127.0.0.1:8179', volume: 1 }
    },
    mcpServers: [],
    persona: { fyr: 'sometimes', character: 'hedgehog' },
    calendar: defaultCalendarConfig(),
    pet: { x: null },
    petMode: false,
    screen: { enabled: true },
    web: { enabled: true },
    app: { warmMinutes: 30, memoryLimitMb: 1500, autostart: false }
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

function pickPositive(value: unknown, fallback: number): number {
  const number = pickNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function pickVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function pickFyr(value: unknown, fallback: FyrLevel): FyrLevel {
  return value === 'off' || value === 'sometimes' || value === 'often' ? value : fallback;
}

function pickCharacter(value: unknown, fallback: CharacterKind): CharacterKind {
  return value === 'hedgehog' || value === 'tishka' ? value : fallback;
}

function pickSensitivity(value: unknown, fallback: Sensitivity): Sensitivity {
  return value === 'low' || value === 'normal' || value === 'high' ? value : fallback;
}

function pickApi(value: unknown, fallback: LlmApi): LlmApi {
  return value === 'chat' || value === 'responses' ? value : fallback;
}

function pickSttMode(value: unknown): SttMode | undefined {
  return value === 'local' || value === 'remote' ? value : undefined;
}

// Настройки без поля mode: заполненные пути программы и модели — местная
// служба, пустые — готовая по адресу.
function inferSttMode(exe: string, model: string): SttMode {
  return exe.trim() !== '' && model.trim() !== '' ? 'local' : 'remote';
}

function pickPetX(value: unknown, fallback: number | null): number | null {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function pickTime(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return undefined;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseDayHours(value: unknown): CalendarDayHours | null {
  if (!isRecord(value)) {
    return null;
  }
  const start = pickTime(value.start);
  const end = pickTime(value.end);
  return start !== undefined && end !== undefined ? { start, end } : null;
}

// Дни недели сливаются со значениями по умолчанию: частичный файл не теряет
// рабочие дни, которые в нём не упомянуты.
function parseWorkHours(value: unknown): CalendarWorkHours {
  const fallback = defaultWorkHours();
  if (!isRecord(value)) {
    return fallback;
  }
  const source = isRecord(value.days) ? value.days : {};
  const days: Partial<Record<CalendarWeekday, CalendarDayHours | null>> = { ...fallback.days };
  for (const day of WEEKDAYS) {
    if (source[day] !== undefined) {
      days[day] = parseDayHours(source[day]);
    }
  }
  const result: CalendarWorkHours = { days };
  const lunch = parseDayHours(value.lunch);
  if (lunch !== null) {
    result.lunch = lunch;
  }
  return result;
}

function parseMic(value: unknown, fallback: Config['voice']['mic']): Config['voice']['mic'] {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    threshold: pickNullableNumber(value.threshold),
    noise: pickNullableNumber(value.noise),
    speech: pickNullableNumber(value.speech),
    calibratedAt: pickNullableString(value.calibratedAt)
  };
}

function parseBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'boolean') {
      result[key] = item;
    }
  }
  return result;
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
      visionModel: config.llm.visionModel.trim(),
      fallbackModel: config.llm.fallbackModel.trim(),
      visionFallbackModel: config.llm.visionFallbackModel.trim(),
      api: pickApi(config.llm.api, 'chat')
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
  const tts = isRecord(voice.tts) ? voice.tts : {};
  const mic = isRecord(voice.mic) ? voice.mic : {};
  const persona = isRecord(value.persona) ? value.persona : {};
  const calendar = isRecord(value.calendar) ? value.calendar : {};
  const pet = isRecord(value.pet) ? value.pet : {};
  const screen = isRecord(value.screen) ? value.screen : {};
  const web = isRecord(value.web) ? value.web : {};
  const app = isRecord(value.app) ? value.app : {};
  return normalizeConfig({
    llm: {
      baseUrl: pickString(llm.baseUrl, defaults.llm.baseUrl),
      model: pickString(llm.model, defaults.llm.model),
      visionModel: pickString(llm.visionModel, defaults.llm.visionModel),
      fallbackModel: pickString(llm.fallbackModel, defaults.llm.fallbackModel),
      visionFallbackModel: pickString(llm.visionFallbackModel, defaults.llm.visionFallbackModel),
      api: pickApi(llm.api, defaults.llm.api)
    },
    voice: {
      hotkey: pickString(voice.hotkey, defaults.voice.hotkey),
      wakeWords: pickStringArray(voice.wakeWords, defaults.voice.wakeWords),
      wakeEnabled: pickBoolean(voice.wakeEnabled, defaults.voice.wakeEnabled),
      talkByDefault: pickBoolean(voice.talkByDefault, defaults.voice.talkByDefault),
      talkTimeoutSec: pickNumber(voice.talkTimeoutSec, defaults.voice.talkTimeoutSec),
      sensitivity: pickSensitivity(voice.sensitivity, defaults.voice.sensitivity),
      mic: parseMic(mic, defaults.voice.mic),
      sttUrl: pickString(voice.sttUrl, defaults.voice.sttUrl),
      stt: (() => {
        const exe = pickString(stt.exe, defaults.voice.stt.exe);
        const model = pickString(stt.model, defaults.voice.stt.model);
        return {
          exe,
          model,
          audioCtx: pickNumber(stt.audioCtx, defaults.voice.stt.audioCtx),
          threads: pickNumber(stt.threads, defaults.voice.stt.threads),
          mode: pickSttMode(stt.mode) ?? inferSttMode(exe, model)
        };
      })(),
      tts: {
        enabled: pickBoolean(tts.enabled, defaults.voice.tts.enabled),
        url: pickString(tts.url, defaults.voice.tts.url),
        volume: pickVolume(tts.volume, defaults.voice.tts.volume)
      }
    },
    mcpServers: parseMcpServers(value.mcpServers),
    persona: {
      fyr: pickFyr(persona.fyr, defaults.persona.fyr),
      character: pickCharacter(persona.character, defaults.persona.character)
    },
    calendar: {
      workHours: parseWorkHours(calendar.workHours),
      defaultRemindMinutes: Math.max(
        0,
        pickNumber(calendar.defaultRemindMinutes, defaults.calendar.defaultRemindMinutes)
      ),
      quietOutsideWork: pickBoolean(calendar.quietOutsideWork, defaults.calendar.quietOutsideWork),
      sources: parseBooleanRecord(calendar.sources)
    },
    pet: { x: pickPetX(pet.x, defaults.pet.x) },
    petMode: pickBoolean(value.petMode, defaults.petMode),
    screen: { enabled: pickBoolean(screen.enabled, defaults.screen.enabled) },
    web: { enabled: pickBoolean(web.enabled, defaults.web.enabled) },
    app: {
      warmMinutes: pickPositive(app.warmMinutes, defaults.app.warmMinutes),
      memoryLimitMb: pickPositive(app.memoryLimitMb, defaults.app.memoryLimitMb),
      autostart: pickBoolean(app.autostart, defaults.app.autostart)
    }
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

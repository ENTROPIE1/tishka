import type { Deed, DeedKind } from '../types';

export const MAX_DEEDS = 5000;

export interface DeedsFile {
  deeds: Deed[];
}

const KINDS: readonly DeedKind[] = ['skill', 'automation', 'draft', 'page', 'event', 'reminder'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKind(value: unknown): value is DeedKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

function parseDeed(value: unknown): Deed | undefined {
  if (!isRecord(value) || !isKind(value.kind) || typeof value.title !== 'string') {
    return undefined;
  }
  const minutes = typeof value.minutes === 'number' && Number.isFinite(value.minutes) && value.minutes >= 0
    ? value.minutes
    : 0;
  const at = typeof value.at === 'string' ? value.at : '';
  const deed: Deed = {
    id: typeof value.id === 'string' && value.id !== '' ? value.id : `${value.title}@${at}`,
    kind: value.kind,
    title: value.title,
    at,
    minutes
  };
  if (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0) {
    deed.durationMs = value.durationMs;
  }
  if (typeof value.steps === 'number' && Number.isInteger(value.steps) && value.steps >= 0) {
    deed.steps = value.steps;
  }
  if (typeof value.skillId === 'string' && value.skillId !== '') {
    deed.skillId = value.skillId;
  }
  return deed;
}

// Повреждённый файл или чужой формат читается как пустой: счётчик не роняет ядро.
export function parseDeedsFile(raw: unknown): DeedsFile {
  if (!isRecord(raw) || !Array.isArray(raw.deeds)) {
    return { deeds: [] };
  }
  const deeds: Deed[] = [];
  for (const item of raw.deeds) {
    const deed = parseDeed(item);
    if (deed !== undefined) {
      deeds.push(deed);
    }
  }
  return { deeds };
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Deed, StatsSummary } from '../types';
import { MAX_DEEDS, parseDeedsFile, type DeedsFile } from './file';
import { summarize } from './summary';
import { DEFAULT_MINUTES, type DeedInput } from './types';

export interface StatsStore {
  load(): Promise<void>;
  record(input: DeedInput): Promise<Deed>;
  list(): Deed[];
  summary(): StatsSummary;
}

export function createStatsStore(opts: { filePath: string; now: () => Date }): StatsStore {
  let deeds: Deed[] = [];
  let loadPromise: Promise<void> | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.catch(() => undefined);
    return result;
  }

  async function readFromDisk(): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(opts.filePath, 'utf8'));
    } catch {
      return;
    }
    deeds = parseDeedsFile(parsed).deeds;
  }

  async function save(): Promise<void> {
    await mkdir(dirname(opts.filePath), { recursive: true });
    const file: DeedsFile = { deeds };
    const temporary = `${opts.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(file, null, 2), 'utf8');
    await rename(temporary, opts.filePath);
  }

  function load(): Promise<void> {
    if (loadPromise === undefined) {
      loadPromise = readFromDisk();
    }
    return loadPromise;
  }

  function makeDeed(input: DeedInput): Deed {
    const minutes = input.minutes ?? DEFAULT_MINUTES[input.kind];
    const deed: Deed = {
      id: randomUUID(),
      kind: input.kind,
      title: input.title,
      at: opts.now().toISOString(),
      minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 0
    };
    if (input.durationMs !== undefined) {
      deed.durationMs = input.durationMs;
    }
    if (input.steps !== undefined) {
      deed.steps = input.steps;
    }
    if (input.skillId !== undefined) {
      deed.skillId = input.skillId;
    }
    return deed;
  }

  return {
    load,

    record(input: DeedInput): Promise<Deed> {
      return exclusive(async () => {
        await load();
        const deed = makeDeed(input);
        deeds.push(deed);
        if (deeds.length > MAX_DEEDS) {
          deeds = deeds.slice(deeds.length - MAX_DEEDS);
        }
        await save();
        return deed;
      });
    },

    list(): Deed[] {
      return [...deeds];
    },

    summary(): StatsSummary {
      return summarize(deeds, opts.now());
    }
  };
}

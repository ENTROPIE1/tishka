import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventBus, Panel, ToolDef, ToolRegistry, ToolResult } from '../types';
import type { CaptureResult, ScreenTarget } from '../vision/look';

export interface ScreenToolsDeps {
  capture(target: ScreenTarget): Promise<CaptureResult>;
  look(question: string | undefined, target: ScreenTarget): Promise<ToolResult>;
  screenshotsDir: string;
  now(): Date;
  events?: EventBus;
}

export const MAX_SHOTS = 50;

const SHOT_NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function shotFileName(at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  return `${date}_${time}.png`;
}

function readTarget(value: unknown): ScreenTarget {
  return value === 'window' ? 'window' : 'screen';
}

function readQuestion(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

// Оставляет не больше max последних снимков, старые удаляются.
export async function pruneShots(dir: string, max: number = MAX_SHOTS): Promise<void> {
  const names = (await readdir(dir)).filter((name) => SHOT_NAME.test(name)).sort();
  const extra = names.length - max;
  for (let index = 0; index < extra; index += 1) {
    await unlink(join(dir, names[index]));
  }
}

const targetProperty = {
  type: 'string',
  enum: ['screen', 'window'],
  description: 'screen — монитор под указателем мыши, window — активное окно'
};

const screenLook: ToolDef = {
  name: 'screen_look',
  description:
    'Делает снимок экрана и разбирает его моделью с картинками, когда человек просит посмотреть на экран или спрашивает «что тут», «что за ошибка».',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Вопрос человека о том, что видно на экране' },
      target: targetProperty
    },
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const screenShot: ToolDef = {
  name: 'screen_shot',
  description:
    'Делает снимок экрана и сохраняет его в файл, когда человек просит просто сделать скриншот без разбора.',
  inputSchema: {
    type: 'object',
    properties: { target: targetProperty },
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

export const SCREEN_TOOL_NAMES = [screenLook.name, screenShot.name] as const;

export function registerScreenTools(registry: ToolRegistry, deps: ScreenToolsDeps, enabled: boolean): void {
  if (!enabled) {
    return;
  }

  registry.register(screenLook, async (args) => {
    deps.events?.emit({ type: 'status', text: 'Смотрю на экран…' });
    return deps.look(readQuestion(args.question), readTarget(args.target));
  });

  registry.register(screenShot, async (args) => {
    deps.events?.emit({ type: 'status', text: 'Смотрю на экран…' });
    const shot = await deps.capture(readTarget(args.target));
    if (!shot.ok) {
      return { ok: false, content: '', error: shot.error };
    }
    try {
      await mkdir(deps.screenshotsDir, { recursive: true });
      const path = join(deps.screenshotsDir, shotFileName(deps.now()));
      await writeFile(path, shot.png);
      await pruneShots(deps.screenshotsDir);
      const panel: Panel = { kind: 'image', title: 'Снимок экрана', path };
      return {
        ok: true,
        content: `Снимок сохранён: ${path}. Покажи человеку карточку с картинкой (show вида image с этим путём).`,
        data: { path, panel }
      };
    } catch {
      return { ok: false, content: '', error: 'Не получилось сохранить снимок' };
    }
  });
}

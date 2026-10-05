// Время разбора экрана до и после на одном и том же снимке.
// Ключ шлюза берётся из переменной окружения DKS_API_KEY.
// Запуск: npx tsx scripts/check-screen-speed.ts [файл-снимка]
// Без файла снимок берётся с текущего экрана (монитор под указателем мыши).
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from '../src/core/agent/agent';
import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import { createLlmClient, LlmError, type ChatRequest, type ChatResponse } from '../src/core/llm/client';
import type { ToolDef, ToolResult } from '../src/core/types';
import { createToolRegistry } from '../src/core/tools/registry';
import { createVisionLook, type CaptureResult } from '../src/core/vision/look';

const require = createRequire(import.meta.url);

interface EncodeResult {
  source: { width: number; height: number };
  captureMs: number;
  old: { path: string; width: number; height: number; bytes: number; ms: number };
  new: {
    pngPath: string;
    jpegPath: string;
    width: number;
    height: number;
    pngBytes: number;
    jpegBytes: number;
    ms: number;
  };
}

const lookDef: ToolDef = {
  name: 'screen_look',
  description: 'Делает снимок экрана и разбирает его по вопросу человека.',
  inputSchema: { type: 'object', properties: {} },
  source: 'builtin',
  readOnly: true
};

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`;
}

function runEncoder(input: string, outDir: string): Promise<EncodeResult> {
  const electron = require('electron') as string;
  const helper = fileURLToPath(new URL('./encode-shot.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const proc = spawnSync(electron, [helper, input, outDir], { encoding: 'utf8' });
    if (proc.error !== undefined) {
      resolve(Promise.reject(proc.error));
      return;
    }
    if (proc.status !== 0) {
      const message = `${proc.stderr ?? ''}${proc.stdout ?? ''}`.trim();
      reject(new Error(message !== '' ? message : 'Кодирование снимка не удалось'));
      return;
    }
    readFile(join(outDir, 'result.json'), 'utf8').then(
      (text) => resolve(JSON.parse(text) as EncodeResult),
      reject
    );
  });
}

// Один прогон агента на том же снимке. answerDirectly=false воспроизводит
// прежнее поведение: разбор экрана возвращается основной модели, и она
// собирает итог вторым шагом.
async function timeFlow(
  chat: (req: ChatRequest) => Promise<ChatResponse>,
  visionModel: string,
  model: string,
  shot: CaptureResult,
  answerDirectly: boolean
): Promise<{ ms: number; steps: number; answer: string }> {
  const events = createEventBus();
  let steps = 0;
  const counted = async (req: ChatRequest): Promise<ChatResponse> => {
    steps += 1;
    return chat(req);
  };
  const look = createVisionLook({
    capture: async () => shot,
    chat: counted,
    visionModel
  });
  const registry = createToolRegistry(events);
  registry.register(lookDef, async (): Promise<ToolResult> => look.look(undefined, 'screen', { answerDirectly }));
  const agent = createAgent({
    llm: { chat: counted },
    registry,
    events,
    getModel: () => model,
    now: () => new Date()
  });
  const started = Date.now();
  const reply = await agent.handle('посмотри на экран');
  return { ms: Date.now() - started, steps, answer: reply.say };
}

async function main(): Promise<void> {
  if (process.env.DKS_API_KEY === undefined || process.env.DKS_API_KEY === '') {
    console.error('Задай переменную окружения DKS_API_KEY');
    process.exitCode = 1;
    return;
  }
  const input = process.argv[2] ?? 'capture';
  const outDir = await mkdtemp(join(tmpdir(), 'tishka-screen-'));
  try {
    const encode = await runEncoder(input, outDir);
    const oldPng = new Uint8Array(await readFile(encode.old.path));
    const newPng = new Uint8Array(await readFile(encode.new.pngPath));
    const newJpeg = new Uint8Array(await readFile(encode.new.jpegPath));

    console.log(`Снимок: ${encode.source.width}×${encode.source.height}`);
    console.log(
      `Вариант «до»   : PNG ${encode.old.width}×${encode.old.height}, ${mb(encode.old.bytes)} ` +
        `(кодирование ${encode.old.ms} мс)`
    );
    console.log(
      `Вариант «после»: JPEG ${encode.new.width}×${encode.new.height}, ${mb(encode.new.jpegBytes)} ` +
        `(кодирование ${encode.new.ms} мс)`
    );

    const config = defaultConfig();
    const client = createLlmClient({
      baseUrl: config.llm.baseUrl,
      getApiKey: async () => process.env.DKS_API_KEY
    });

    const beforeShot: CaptureResult = {
      ok: true,
      png: oldPng,
      width: encode.old.width,
      height: encode.old.height,
      source: 'Монитор'
    };
    const afterShot: CaptureResult = {
      ok: true,
      png: newPng,
      jpeg: newJpeg,
      width: encode.new.width,
      height: encode.new.height,
      source: 'Монитор'
    };

    console.log('Разбираю «до»…');
    const before = await timeFlow(client.chat, config.llm.visionModel, config.llm.model, beforeShot, false);
    console.log('Разбираю «после»…');
    const after = await timeFlow(client.chat, config.llm.visionModel, config.llm.model, afterShot, true);

    console.log('');
    console.log(`Разбор «до»   : ${seconds(before.ms)}, шагов модели: ${before.steps}`);
    console.log(`Разбор «после»: ${seconds(after.ms)}, шагов модели: ${after.steps}`);
    console.log('');
    console.log(`Ответ «до»   : ${before.answer}`);
    console.log(`Ответ «после»: ${after.answer}`);
  } finally {
    await rm(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error: unknown) => {
  if (error instanceof LlmError) {
    console.error(`Ошибка (${error.kind}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : 'Непредвиденная ошибка');
  }
  process.exitCode = 1;
});

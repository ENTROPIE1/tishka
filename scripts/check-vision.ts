import { readFile } from 'node:fs/promises';
import { defaultConfig } from '../src/core/config';
import { createLlmClient, LlmError } from '../src/core/llm/client';
import { createVisionLook } from '../src/core/vision/look';

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (file === undefined || file === '') {
    console.error('Использование: npx tsx scripts/check-vision.ts <картинка.png> ["вопрос"]');
    process.exitCode = 1;
    return;
  }
  const question = process.argv[3];
  const config = defaultConfig();
  const bytes = await readFile(file);

  const client = createLlmClient({
    baseUrl: config.llm.baseUrl,
    getApiKey: async () => process.env.DKS_API_KEY
  });
  const look = createVisionLook({
    capture: async () => ({
      ok: true,
      png: new Uint8Array(bytes),
      width: 0,
      height: 0,
      source: file
    }),
    chat: (req) => client.chat(req),
    visionModel: config.llm.visionModel
  });

  console.log(`Модель: ${config.llm.visionModel}`);
  const started = Date.now();
  const result = await look.look(question, 'screen');
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (!result.ok) {
    fail(result.error ?? 'Не получилось разобрать картинку');
    return;
  }
  console.log(`Ответ за ${elapsed} с:`);
  console.log(result.content);
}

main().catch((error: unknown) => {
  if (error instanceof LlmError) {
    console.error(`Ошибка (${error.kind}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : 'Непредвиденная ошибка');
  }
  process.exitCode = 1;
});

import { writeFile } from 'node:fs/promises';
import { defaultConfig } from '../src/core/config';
import { prepareForSpeech } from '../src/voice/speech-text';
import { createTtsClient } from '../src/voice/tts-client';

interface CheckArgs {
  phrase?: string;
  url: string;
  out?: string;
}

function parseArgs(argv: string[]): CheckArgs {
  let url = defaultConfig().voice.tts.url;
  let out: string | undefined;
  let phrase: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') {
      index += 1;
      if (argv[index] !== undefined) {
        url = argv[index];
      }
    } else if (arg === '--out') {
      index += 1;
      if (argv[index] !== undefined) {
        out = argv[index];
      }
    } else if (phrase === undefined) {
      phrase = arg;
    }
  }
  return { phrase, url, out };
}

async function main(): Promise<void> {
  const { phrase, url, out } = parseArgs(process.argv.slice(2));
  if (phrase === undefined) {
    console.error('Укажите фразу: npx tsx scripts/check-tts.ts "<фраза>" [--url адрес] [--out файл.wav]');
    process.exitCode = 1;
    return;
  }

  const prepared = prepareForSpeech(phrase);
  console.log(`Подготовленный текст: ${prepared}`);

  const client = createTtsClient({ url });
  const started = Date.now();
  const result = await client.synthesize(prepared);
  const seconds = ((Date.now() - started) / 1000).toFixed(2);

  if (!result.ok) {
    console.error(`Ошибка: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Время ответа службы: ${seconds} с`);
  if (out !== undefined) {
    await writeFile(out, result.wav);
    console.log(`Звук сохранён: ${out} (${result.wav.length} байт)`);
  } else {
    console.log(`Получено звука: ${result.wav.length} байт`);
  }
}

void main();

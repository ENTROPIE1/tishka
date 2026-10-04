import { readFile } from 'node:fs/promises';
import { defaultConfig } from '../src/core/config';
import { createSttService } from '../src/voice/stt-service';

interface CheckArgs {
  file?: string;
  url: string;
}

function parseArgs(argv: string[]): CheckArgs {
  let url = defaultConfig().voice.sttUrl;
  let file: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') {
      i += 1;
      if (argv[i] !== undefined) {
        url = argv[i];
      }
    } else if (file === undefined) {
      file = argv[i];
    }
  }
  return { file, url };
}

async function main(): Promise<void> {
  const { file, url } = parseArgs(process.argv.slice(2));
  if (file === undefined) {
    console.error('Укажите файл: npx tsx scripts/check-stt.ts <файл.wav> [--url адрес]');
    process.exitCode = 1;
    return;
  }

  const service = createSttService({
    getConfig: () => ({ ...defaultConfig().voice, sttUrl: url })
  });
  const wav = new Uint8Array(await readFile(file));
  const started = Date.now();
  const result = await service.transcribe(wav);
  const seconds = ((Date.now() - started) / 1000).toFixed(2);

  if (!result.ok) {
    console.error(`Ошибка: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(result.text);
  console.log(`Время: ${seconds} с`);
}

void main();

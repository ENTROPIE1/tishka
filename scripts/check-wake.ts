import { readFile } from 'node:fs/promises';
import { defaultConfig } from '../src/core/config';
import { createSttService } from '../src/voice/stt-service';
import { matchWake, wakePrompt } from '../src/voice/wake';

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
    console.error('Укажите файл: npx tsx scripts/check-wake.ts <файл.wav> [--url адрес]');
    process.exitCode = 1;
    return;
  }

  const voice = { ...defaultConfig().voice, sttUrl: url };
  const service = createSttService({ getConfig: () => voice });
  const wav = new Uint8Array(await readFile(file));
  const result = await service.transcribe(wav, wakePrompt(voice.wakeWords));

  if (!result.ok) {
    console.error(`Ошибка: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  const match = matchWake(result.text, voice.wakeWords);
  console.log(`Текст: ${result.text}`);
  console.log(match.matched ? `Имя найдено, просьба: ${match.rest || '(пусто)'}` : 'Имя не найдено');
}

void main();

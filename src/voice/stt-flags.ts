import { dirname, join } from 'node:path';

// Ключи запуска whisper.cpp против выдумок. Значения читаются из справки
// программы: старые сборки не знают этих ключей и запускаются как раньше.
export interface HelpCaps {
  suppressNst: boolean;   // -sns / --suppress-nst: не выдавать неречевые токены
  vad: boolean;           // --vad: встроенный детектор речи
}

export type SttDetector = 'on' | 'no-model' | 'off';

// В справке ключ может стоять один или с парой: «-sns, --suppress-nst»,
// «--vad, --vad-model FNAME». Отдельно «--vad-model» ключом --vad не считается.
export function parseHelpCaps(help: string): HelpCaps {
  return {
    suppressNst: /(^|\s)-sns(\s|,|$)/m.test(help) || /--suppress-nst/.test(help),
    vad: /(^|\s)--vad(\s|,|=|$)/m.test(help)
  };
}

// Файл модели детектора лежит рядом с моделью распознавания.
export function findVadModel(modelPath: string, list: (dir: string) => string[]): string | undefined {
  const dir = dirname(modelPath);
  let entries: string[];
  try {
    entries = list(dir);
  } catch {
    return undefined;
  }
  const match = entries.find((name) => /^ggml-silero-.*\.bin$/i.test(name));
  return match === undefined ? undefined : join(dir, match);
}

export function detectorState(caps: HelpCaps, vadModel: string | undefined): SttDetector {
  if (!caps.vad) {
    return 'off';
  }
  return vadModel === undefined ? 'no-model' : 'on';
}

// Ключ -mc 0 намеренно не ставится: он отключает подсказку с именем, и имя
// распознаётся хуже.
export function buildServiceArgs(base: string[], caps: HelpCaps, vadModel: string | undefined): string[] {
  const args = [...base];
  if (caps.suppressNst) {
    args.push('-sns');
  }
  if (caps.vad && vadModel !== undefined) {
    args.push('--vad', '--vad-model', vadModel);
  }
  return args;
}

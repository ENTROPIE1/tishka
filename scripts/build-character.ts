import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, type ModelSources, type RigModel } from '../src/renderer/character-rig/rig-data';

// Собирает один model.json из исходников assets/tishka/model, чтобы проигрыватель
// читал только его, а спрайты и клипы оставались в файлах модели.

const SOURCES: (keyof ModelSources)[] = ['rig', 'masks', 'eyes', 'hands', 'fx', 'clips'];
const FILES: Record<keyof ModelSources, string> = {
  rig: 'rig_data.js',
  masks: 'layers_meta.js',
  eyes: 'eyes_meta.js',
  hands: 'hands_meta.js',
  fx: 'fx_meta.js',
  clips: 'clips.js'
};

export function readSources(modelDir: string): ModelSources {
  const sources = {} as ModelSources;
  for (const key of SOURCES) {
    sources[key] = readFileSync(join(modelDir, FILES[key]), 'utf8');
  }
  return sources;
}

export function readEmotions(modelDir: string): string | undefined {
  const file = join(modelDir, 'emotions.js');
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

export interface MoodInfo {
  ru: string;
  emote?: true;   // сценка, а не эмоция
  alias?: true;   // прежнее имя настроения: метка принимается, в подсказку не идёт
}

// Имена для меток [эмоция] в репликах: neutral (лицо по клипу), эмоции, сценки и
// прежние настроения ответа (happy, confused) как синонимы из MOOD_EMOTION.
// Ядро берёт отсюда список для подсказки модели и отбрасывает незнакомые метки.
export function moodList(model: RigModel): Record<string, MoodInfo> {
  const out: Record<string, MoodInfo> = { neutral: { ru: 'спокойно, лицо по действию' } };
  for (const [name, emotion] of Object.entries(model.emotions ?? {})) {
    out[name] = { ru: emotion.ru };
  }
  for (const [name, emote] of Object.entries(model.emotes ?? {})) {
    out[name] = { ru: emote.ru, emote: true };
  }
  for (const [name, target] of Object.entries(model.moodEmotion ?? {})) {
    if (out[name] === undefined) {
      out[name] = { ru: model.emotions?.[target]?.ru ?? target, alias: true };
    }
  }
  return out;
}

function main(): void {
  const modelDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tishka', 'model');
  const model = buildModel(readSources(modelDir), readEmotions(modelDir));
  const out = join(modelDir, 'model.json');
  writeFileSync(out, JSON.stringify(model), 'utf8');
  if (model.emotions !== undefined) {
    writeFileSync(join(modelDir, 'moods.json'), `${JSON.stringify(moodList(model), null, 2)}
`, 'utf8');
  }
  console.log(
    `Собрано ${out}: костей ${model.bones.length}, слоёв ${model.layers.length}, клипов ${Object.keys(model.clips).length}, ` +
      `эмоций ${Object.keys(model.emotions ?? {}).length}, сценок ${Object.keys(model.emotes ?? {}).length}`
  );
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('build-character.ts');
if (invokedDirectly) {
  main();
}

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, type ModelSources } from '../src/renderer/character-rig/rig-data';

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

function main(): void {
  const modelDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tishka', 'model');
  const model = buildModel(readSources(modelDir));
  const out = join(modelDir, 'model.json');
  writeFileSync(out, JSON.stringify(model), 'utf8');
  console.log(`Собрано ${out}: костей ${model.bones.length}, слоёв ${model.layers.length}, клипов ${Object.keys(model.clips).length}`);
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('build-character.ts');
if (invokedDirectly) {
  main();
}

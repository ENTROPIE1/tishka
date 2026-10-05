import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildModel, parseModel, type ModelSources } from '../src/renderer/character-rig/rig-data';

const modelDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tishka', 'model');

const FILES: Record<keyof ModelSources, string> = {
  rig: 'rig_data.js',
  masks: 'layers_meta.js',
  eyes: 'eyes_meta.js',
  hands: 'hands_meta.js',
  fx: 'fx_meta.js',
  clips: 'clips.js'
};

function readSources(): ModelSources {
  const sources = {} as ModelSources;
  for (const key of Object.keys(FILES) as (keyof ModelSources)[]) {
    sources[key] = readFileSync(join(modelDir, FILES[key]), 'utf8');
  }
  return sources;
}

describe('model.json', () => {
  it('совпадает с исходниками модели', () => {
    const built = buildModel(readSources());
    const stored = parseModel(readFileSync(join(modelDir, 'model.json'), 'utf8'));
    expect(stored).toEqual(built);
  });

  it('собраны скелет, слои, маски, варианты и клипы', () => {
    const model = parseModel(readFileSync(join(modelDir, 'model.json'), 'utf8'));
    expect(model.bones).toHaveLength(27);
    expect(model.layers).toHaveLength(176);
    expect(Object.keys(model.clips)).toContain('dance');
    expect(Object.keys(model.clips)).toHaveLength(13);
    expect(Object.keys(model.masks).length).toBeGreaterThan(100);
    expect(model.eyeShapes['surprised']).toEqual({ white: true, irisScale: 0.8 });
    expect(model.irisVariants).toContain('heart');
    expect(model.handAnchors['relaxed'].ax).toBeCloseTo(182.7);
    expect(model.mouths).toContain('m_closed');
    expect(model.fx).toContain('sparkles');
    expect(model.moods['happy']).toBeDefined();
  });
});

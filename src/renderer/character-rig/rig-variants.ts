// Списки вариантов для стенда: какие глаза, брови, рты, кисти и эффекты есть в модели.

import type { RigModel } from './rig-data';

export function groupVariants(model: RigModel, group: string): string[] {
  const out: string[] = [];
  for (const layer of model.layers) {
    if (layer.group === group && layer.variant !== undefined && !out.includes(layer.variant)) {
      out.push(layer.variant);
    }
  }
  return out;
}

export function eyeShapeList(model: RigModel): string[] {
  return ['orig', ...Object.keys(model.eyeShapes)];
}

export function irisList(model: RigModel): string[] {
  return model.irisVariants;
}

export function browList(model: RigModel): string[] {
  return groupVariants(model, 'brow_l');
}

export function mouthList(model: RigModel): string[] {
  return ['closed', 'half', 'open', 'sad', ...model.mouths];
}

export function handList(model: RigModel): string[] {
  return groupVariants(model, 'hand_l');
}

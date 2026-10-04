export interface Frame {
  samples: Float32Array;
  level: number;
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i];
  }
  return frame.length === 0 ? 0 : Math.sqrt(sum / frame.length);
}

// Обрезка записи по порогу: убираем тишину по краям, оставляя небольшой запас.
export function trimByThreshold(frames: Frame[], threshold: number): Float32Array {
  let first = -1;
  let last = -1;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].level > threshold) {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  if (first < 0) {
    first = 0;
    last = frames.length - 1;
  }
  const from = Math.max(0, first - 5);
  const to = Math.min(frames.length - 1, last + 5);
  const parts = frames.slice(from, to + 1);
  const merged = new Float32Array(parts.reduce((total, part) => total + part.samples.length, 0));
  let offset = 0;
  for (const part of parts) {
    merged.set(part.samples, offset);
    offset += part.samples.length;
  }
  return merged;
}

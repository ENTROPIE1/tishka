export function envelope(samples: ArrayLike<number>, sampleRate: number, windowMs: number): number[] {
  const total = samples.length;
  if (total === 0 || sampleRate <= 0 || windowMs <= 0) {
    return [];
  }
  const windowSize = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const values: number[] = [];
  for (let start = 0; start < total; start += windowSize) {
    const end = Math.min(total, start + windowSize);
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index] ?? 0;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / (end - start));
    values.push(Math.min(1, Math.max(0, rms)));
  }
  return values;
}

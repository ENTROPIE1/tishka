export type CalibrationQuality = 'good' | 'weak' | 'bad';

export interface NoiseStats {
  noise: number;   // медиана кадров тишины
  peak: number;    // 95-й процентиль кадров тишины
}

export interface SpeechStats {
  speech: number;      // уровень тихих частей речи
  loudFrames: number;  // сколько кадров громче шумового пика
}

export interface ThresholdResult {
  threshold: number;
  quality: CalibrationQuality;
  ratio: number;
}

export const MIN_THRESHOLD = 0.0015;
export const NOISE_FLOOR_FACTOR = 1.5;
export const SPEECH_CEIL_FACTOR = 0.7;
export const GOOD_RATIO = 4;
export const WEAK_RATIO = 2;
export const MIN_LOUD_FRAMES = 10;

// Процентиль по возрастающему ряду с линейной интерполяцией между соседями.
export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = Math.min(1, Math.max(0, fraction)) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sorted[low];
  }
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function sortedCopy(levels: number[]): number[] {
  return [...levels].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
}

// Тишина: медиана как оценка уровня шума и 95-й процентиль как его пик.
export function measureNoise(levels: number[]): NoiseStats {
  const sorted = sortedCopy(levels);
  return {
    noise: percentile(sorted, 0.5),
    peak: percentile(sorted, 0.95)
  };
}

// Речь: тихие части речи — 30-й процентиль кадров, которые громче шумового пика.
export function measureSpeech(levels: number[], noisePeak: number): SpeechStats {
  const loud = sortedCopy(levels).filter((value) => value > noisePeak);
  if (loud.length === 0) {
    return { speech: 0, loudFrames: 0 };
  }
  return { speech: percentile(loud, 0.3), loudFrames: loud.length };
}

// Порог — среднее геометрическое шума и речи, зажатое между шум × 1,5 и речь × 0,7.
export function computeThreshold(
  noisePeak: number,
  speech: number,
  loudFrames = Number.POSITIVE_INFINITY
): ThresholdResult {
  const safeNoise = Math.max(0, noisePeak);
  const safeSpeech = Math.max(0, speech);
  const ratio = safeNoise > 0 ? safeSpeech / safeNoise : 0;

  const geometric = Math.sqrt(safeNoise * safeSpeech);
  const floor = Math.max(safeNoise * NOISE_FLOOR_FACTOR, MIN_THRESHOLD);
  let threshold = Math.max(geometric, floor);
  if (safeSpeech > 0) {
    threshold = Math.min(threshold, safeSpeech * SPEECH_CEIL_FACTOR);
  }
  threshold = Math.max(threshold, MIN_THRESHOLD);

  let quality: CalibrationQuality = 'bad';
  if (loudFrames >= MIN_LOUD_FRAMES) {
    if (ratio >= GOOD_RATIO) {
      quality = 'good';
    } else if (ratio >= WEAK_RATIO) {
      quality = 'weak';
    }
  }

  return { threshold, quality, ratio };
}

// Дорожка рта и моменты смены эмоций для реплики: по тексту, ушедшему в синтез,
// и огибающей громкости её звука. Чистые функции, без DOM. Перенос алгоритма
// assets/tishka/model/reference/lipsync.py.

export const MOUTH_FPS = 60;

// Кадр, с которого начинается форма: 'rest' означает закрытый рот.
export interface MouthTrack {
  fps: number;
  frames: number;
  mouth: [number, string][];
}

// Момент смены эмоции: at — секунды от начала звука.
export interface MoodTimeMark {
  at: number;
  mood: string;
}

const VOWELS = new Set('аяоёуюэеиыАЯОЁУЮЭЕИЫ');

const VOWEL_SHAPES: Record<string, string> = {
  а: 'm_a',
  я: 'm_a',
  о: 'm_o',
  ё: 'm_o',
  у: 'm_u',
  ю: 'm_u',
  э: 'm_e',
  е: 'm_e',
  и: 'm_e',
  ы: 'm_e'
};

const CONSONANT_SHAPES: Record<string, string> = {
  м: 'm_closed',
  б: 'm_closed',
  п: 'm_closed',
  ф: 'm_f',
  в: 'm_f',
  л: 'm_l'
};

export function isVowel(ch: string): boolean {
  return VOWELS.has(ch);
}

// Форма рта для буквы: известные согласные — свои, остальные — m_teeth.
export function visemeFor(ch: string): string {
  const lower = ch.toLowerCase();
  return VOWEL_SHAPES[lower] ?? CONSONANT_SHAPES[lower] ?? 'm_teeth';
}

function isLetter(ch: string): boolean {
  return /[а-яё]/i.test(ch);
}

function letters(text: string): string[] {
  return [...text].filter(isLetter);
}

// Сглаживание окном в три кадра и приведение к максимуму — как в образце.
function normalize(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  let max = 0;
  for (const value of values) {
    if (value > max) {
      max = value;
    }
  }
  const divisor = max > 0 ? max : 1;
  const smoothed = values.map((value, index) => {
    const prev = values[index - 1] ?? 0;
    const next = values[index + 1] ?? 0;
    return (prev + value + next) / 3;
  });
  return smoothed.map((value) => value / divisor);
}

interface Layout {
  frames: number;
  events: [number, string][];
  letterStart: number[];
  lastActive: number;
}

// Раскладка букв по звучащим кадрам: каждой букве — доля кадров по весу
// (гласная 1, согласная 0,6). Форма держится не меньше 50 мс.
function layout(text: string, envelope: number[], fps: number): Layout {
  const env = normalize(envelope);
  const frames = env.length;
  const active: number[] = [];
  for (let index = 0; index < frames; index += 1) {
    if ((env[index] ?? 0) > 0.08) {
      active.push(index);
    }
  }
  const chars = letters(text);
  const weights = chars.map((ch) => (isVowel(ch) ? 1 : 0.6));
  const track: string[] = new Array(frames).fill('rest');
  const letterStart: number[] = [];
  const lastActive = active.length === 0 ? 0 : active[active.length - 1];

  if (active.length > 0 && chars.length > 0) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const cum: number[] = [0];
    for (const weight of weights) {
      cum.push(cum[cum.length - 1] + (weight / total) * active.length);
    }
    for (let k = 0; k < chars.length; k += 1) {
      const a0 = Math.round(cum[k]);
      const a1 = Math.max(Math.round(cum[k + 1]), a0 + 1);
      const start = Math.min(a0, active.length - 1);
      letterStart.push(active[Math.max(0, start)]);
      for (let j = a0; j < a1 && j < active.length; j += 1) {
        const frame = active[j];
        const ch = chars[k];
        let shape = visemeFor(ch);
        if (isVowel(ch) && (env[frame] ?? 0) < 0.3 && (shape === 'm_a' || shape === 'm_e')) {
          shape = 'm_teeth';
        }
        track[frame] = shape;
      }
    }
  }

  const minFrames = Math.max(1, Math.round((fps * 50) / 1000));
  const events: [number, string][] = [];
  for (let t = 0; t < track.length; t += 1) {
    const value = track[t];
    if (events.length === 0 || events[events.length - 1][1] !== value) {
      const previous = events[events.length - 1];
      if (previous !== undefined && t - previous[0] < minFrames && events.length > 1) {
        previous[1] = value;
        continue;
      }
      events.push([t, value]);
    }
  }
  return { frames, events, letterStart, lastActive };
}

export function buildMouthTrack(text: string, envelope: number[], fps = MOUTH_FPS): MouthTrack {
  const { frames, events } = layout(text, envelope, fps);
  return { fps, frames, mouth: events };
}

// Форма рта в момент времени звука: последнее событие не позже кадра.
export function visemeAt(track: MouthTrack, timeSec: number): string | null {
  const frame = Math.floor(timeSec * track.fps);
  let shape: string | null = null;
  for (const [at, value] of track.mouth) {
    if (at > frame) {
      break;
    }
    shape = value === 'rest' ? null : value;
  }
  return shape;
}

function lettersBefore(text: string, at: number): number {
  let count = 0;
  const limit = Math.min(Math.max(at, 0), text.length);
  for (let index = 0; index < limit; index += 1) {
    if (isLetter(text[index])) {
      count += 1;
    }
  }
  return count;
}

// Позиции в знаках текста — во время звука по той же раскладке букв, что и рот.
export function moodTimeMarks(
  text: string,
  moods: { at: number; mood: string }[],
  envelope: number[],
  fps = MOUTH_FPS
): MoodTimeMark[] {
  const { letterStart, lastActive } = layout(text, envelope, fps);
  return moods.map((mark) => {
    const index = lettersBefore(text, mark.at);
    const frame = index < letterStart.length ? letterStart[index] : lastActive;
    return { at: fps > 0 ? frame / fps : 0, mood: mark.mood };
  });
}

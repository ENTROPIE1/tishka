import { describe, expect, it } from 'vitest';
import { buildMouthTrack, moodTimeMarks, visemeAt, visemeFor, MOUTH_FPS } from '../src/voice/lipsync';

function speech(frames: number, level = 0.5): number[] {
  return new Array<number>(frames).fill(level);
}

function silent(frames: number): number[] {
  return new Array<number>(frames).fill(0);
}

describe('visemeFor', () => {
  it('гласные и согласные дают свои формы, прочее — m_teeth', () => {
    expect(visemeFor('а')).toBe('m_a');
    expect(visemeFor('Я')).toBe('m_a');
    expect(visemeFor('о')).toBe('m_o');
    expect(visemeFor('ю')).toBe('m_u');
    expect(visemeFor('и')).toBe('m_e');
    expect(visemeFor('м')).toBe('m_closed');
    expect(visemeFor('в')).toBe('m_f');
    expect(visemeFor('л')).toBe('m_l');
    expect(visemeFor('р')).toBe('m_teeth');
  });
});

describe('buildMouthTrack', () => {
  it('фраза «мама» на ровной огибающей: формы на гласных и согласных', () => {
    const track = buildMouthTrack('мама', speech(60));

    expect(track.fps).toBe(MOUTH_FPS);
    expect(track.frames).toBe(60);
    expect(visemeAt(track, 0.02)).toBe('m_closed');
    expect(visemeAt(track, 0.3)).toBe('m_a');
    expect(visemeAt(track, 0.6)).toBe('m_closed');
    expect(visemeAt(track, 0.9)).toBe('m_a');
    // rest чередуется с четырьмя формами: смен формы — три.
    expect(track.mouth.filter(([, shape]) => shape === 'rest')).toHaveLength(0);
    expect(track.mouth).toHaveLength(4);
  });

  it('тихий гласный — m_teeth, а не открытая форма', () => {
    // Громкая часть задаёт максимум огибающей; тихие кадры той же гласной
    // идут как m_teeth.
    const track = buildMouthTrack('а', [...speech(15, 0.2), ...speech(15, 1)]);

    expect(track.mouth[0][1]).toBe('m_teeth');
    expect(track.mouth.some(([, shape]) => shape === 'm_a')).toBe(true);
  });

  it('форма держится не меньше 50 мс (3 кадров)', () => {
    const env = [...silent(6), ...speech(60)];
    const track = buildMouthTrack('мама', env);

    for (let index = 1; index < track.mouth.length; index += 1) {
      const gap = track.mouth[index][0] - track.mouth[index - 1][0];
      expect(gap).toBeGreaterThanOrEqual(3);
    }
  });

  it('частые буквы на коротком звуке не мелькают', () => {
    const track = buildMouthTrack('абракадабра', speech(12));

    // Двенадцать букв на двенадцати звучащих кадрах дали бы десяток смен;
    // сглаживание оставляет заметно меньше.
    expect(track.mouth.length).toBeLessThan(8);
  });
});

describe('visemeAt', () => {
  it('до первого события рот закрыт', () => {
    const track = buildMouthTrack('а', [...silent(12), ...speech(30)]);
    expect(visemeAt(track, 0)).toBeNull();
  });
});

describe('moodTimeMarks', () => {
  it('позиции в знаках переводятся во время по раскладке букв', () => {
    const env = speech(60);
    const marks = [
      { at: 0, mood: 'neutral' },
      { at: 18, mood: 'happy' }
    ];
    const times = moodTimeMarks('Сейчас посмотрю. Нашёл!', marks, env);

    expect(times).toHaveLength(2);
    expect(times[0].mood).toBe('neutral');
    expect(times[1].mood).toBe('happy');
    expect(times[0].at).toBeGreaterThanOrEqual(0);
    expect(times[1].at).toBeGreaterThan(times[0].at);
  });
});

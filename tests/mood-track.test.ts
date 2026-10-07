import { describe, expect, it, vi } from 'vitest';
import { createMoodTrack } from '../src/renderer/pet/mood-track';

function track(): { track: ReturnType<typeof createMoodTrack>; moods: string[] } {
  const moods: string[] = [];
  return { track: createMoodTrack({ setMood: (name) => moods.push(name) }), moods };
}

describe('createMoodTrack', () => {
  it('настроение ответа задаёт эмоцию в начале реплики', () => {
    const { track: mood, moods } = track();

    mood.reply('happy');
    expect(moods).toEqual(['happy']);
  });

  it('без настроения ответа лицо остаётся neutral', () => {
    const { track: mood, moods } = track();

    mood.reply(undefined);
    expect(moods).toEqual(['neutral']);
  });

  it('метка внутри реплики меняет эмоцию, повтор не дублируется', () => {
    const { track: mood, moods } = track();

    mood.reply('neutral');
    mood.mark('happy');
    mood.mark('happy');
    expect(moods).toEqual(['neutral', 'happy']);
  });

  it('покой и уход сбрасывают эмоцию в neutral, работа — нет', () => {
    const { track: mood, moods } = track();

    mood.reply('confused');
    mood.state('talking');
    mood.state('listening');
    expect(moods).toEqual(['confused']);

    mood.state('idle');
    mood.state('leave');
    expect(moods).toEqual(['confused', 'neutral']);
  });

  it('пока звучит речь, idle не сбрасывает лицо', () => {
    const { track: mood, moods } = track();

    mood.reply('happy');
    mood.hold(true);
    mood.mark('joy');
    mood.state('idle');
    expect(moods).toEqual(['happy', 'joy']);

    mood.hold(false);
    expect(moods).toEqual(['happy', 'joy', 'neutral']);
  });

  it('apply возвращает текущую эмоцию пересозданному лицу', () => {
    const { track: mood, moods } = track();

    mood.reply('happy');
    mood.apply();
    expect(moods).toEqual(['happy', 'happy']);
  });

  it('персонаж без setMood (прежний ёж) не ломается', () => {
    const mood = createMoodTrack({});

    expect(() => {
      mood.reply('happy');
      mood.mark('confused');
      mood.state('idle');
      mood.apply();
    }).not.toThrow();
  });

  it('сброс в покое повторяется только один раз', () => {
    const { track: mood, moods } = track();
    const setMood = vi.fn();
    const other = createMoodTrack({ setMood });

    mood.state('idle');
    mood.state('idle');
    other.state('idle');
    other.state('hidden');
    expect(moods).toEqual(['neutral']);
    expect(setMood).toHaveBeenCalledTimes(1);
  });
});

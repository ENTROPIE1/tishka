import { describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createStopPhrase, STOP_CAPTION, type StopPhraseDeps } from '../src/voice/stop-phrase';

function mount(): { deps: StopPhraseDeps; stops: string[]; captions: string[]; bus: ReturnType<typeof createEventBus> } {
  const bus = createEventBus();
  const stops: string[] = [];
  const captions: string[] = [];
  const deps: StopPhraseDeps = {
    bus,
    wakeWords: () => ['тишка'],
    cancel: () => stops.push('work'),
    stopSpeech: () => stops.push('speech'),
    caption: (text) => captions.push(text)
  };
  return { deps, stops, captions, bus };
}

describe('stop-phrase: занятость', () => {
  it('вне работы фразы не перехватываются', () => {
    const { deps, stops, captions } = mount();
    const stop = createStopPhrase(deps);
    expect(stop.phrase('стоп')).toBe(false);
    expect(stops).toEqual([]);
    expect(captions).toEqual([]);
    stop.dispose();
  });

  it('во время работы «стоп» останавливает работу и речь, подпись «остановил»', () => {
    const { deps, stops, captions, bus } = mount();
    const stop = createStopPhrase(deps);
    bus.emit({ type: 'think.start' });

    expect(stop.phrase('стоп')).toBe(true);
    expect(stops).toEqual(['work', 'speech']);
    expect(captions).toEqual([STOP_CAPTION]);
    stop.dispose();
  });

  it('слова остановки узнаются с именем и без', () => {
    const { deps, stops, bus } = mount();
    const stop = createStopPhrase(deps);
    bus.emit({ type: 'speak.start', text: 'Фыр. Слушаю.' });

    for (const phrase of ['Стоп!', 'Тишка, стоп', 'хватит', 'Тишка, хватит', 'остановись', 'отмена']) {
      expect(stop.phrase(phrase), phrase).toBe(true);
    }
    expect(stops.filter((item) => item === 'work')).toHaveLength(6);
    stop.dispose();
  });

  it('занятому Тишке обычная фраза не уходит в ядро и ничего не останавливает', () => {
    const { deps, stops, captions, bus } = mount();
    const stop = createStopPhrase(deps);
    bus.emit({ type: 'tool.start', tool: 'screen_look' });

    expect(stop.phrase('какие встречи сегодня')).toBe(true);
    expect(stops).toEqual([]);
    expect(captions).toEqual([]);
    stop.dispose();
  });

  it('работа кончилась простоем: слова снова уходят как реплика', () => {
    const { deps, stops, bus } = mount();
    const stop = createStopPhrase(deps);
    bus.emit({ type: 'think.start' });
    bus.emit({ type: 'idle' });

    expect(stop.phrase('стоп')).toBe(false);
    expect(stops).toEqual([]);
    stop.dispose();
  });

  it('речь кончилась speak.end: перехват снимается', () => {
    const { deps, stops, bus } = mount();
    const stop = createStopPhrase(deps);
    bus.emit({ type: 'speak.start', text: 'Готово' });
    expect(stop.phrase('стоп')).toBe(true);
    bus.emit({ type: 'speak.end' });

    expect(stop.phrase('стоп')).toBe(false);
    expect(stops.filter((item) => item === 'work')).toHaveLength(1);
    stop.dispose();
  });

  it('dispose снимает подписку: события больше не меняют занятость', () => {
    const { deps, stops, bus } = mount();
    const stop = createStopPhrase(deps);
    stop.dispose();
    bus.emit({ type: 'think.start' });

    expect(stop.phrase('стоп')).toBe(false);
    expect(stops).toEqual([]);
  });
});

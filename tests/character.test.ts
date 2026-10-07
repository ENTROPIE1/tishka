// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PetState } from '../src/pet/state';
import { clipForState, type ClipName } from '../src/renderer/pet/character';
import { SvgHedgehog } from '../src/renderer/pet/svg-hedgehog';

const TABLE: Record<PetState, { clip: ClipName; flip: boolean }> = {
  appear: { clip: 'peek', flip: false },
  leave: { clip: 'happy', flip: false },
  idle: { clip: 'idle', flip: false },
  listening: { clip: 'listen', flip: false },
  thinking: { clip: 'think', flip: false },
  working: { clip: 'work', flip: false },
  talking: { clip: 'talk', flip: false },
  notify: { clip: 'notify', flip: false },
  happy: { clip: 'happy', flip: false },
  confused: { clip: 'confused', flip: false },
  sleep: { clip: 'sleep', flip: false },
  hidden: { clip: 'idle', flip: false }
};

async function mount(): Promise<{
  container: HTMLElement;
  character: SvgHedgehog;
  root: SVGSVGElement;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const character = new SvgHedgehog();
  await character.mount(container);
  const root = container.querySelector<SVGSVGElement>('svg.hedgehog');
  if (root === null) {
    throw new Error('SVG не смонтирован');
  }
  return { container, character, root };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('clipForState', () => {
  it('для каждого состояния даёт клип и отражение из таблицы', () => {
    for (const state of Object.keys(TABLE) as PetState[]) {
      expect(clipForState(state)).toEqual(TABLE[state]);
    }
  });
});

describe('SvgHedgehog', () => {
  it('после mount в контейнере есть SVG с группами тела, иголок, глаз, рта и лап', async () => {
    const { root } = await mount();
    for (const id of ['hh-body', 'hh-spikes', 'hh-eyes', 'hh-mouth', 'hh-legs']) {
      expect(root.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it('стили не вставляются тегом style и в разметке нет атрибутов style', async () => {
    const { container, root } = await mount();
    expect(document.querySelector('style')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    expect(root.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('setClip ставит класс клипа и убирает прежний', async () => {
    const { character, root } = await mount();
    character.setClip('walk');
    expect(root.classList.contains('clip-walk')).toBe(true);

    character.setClip('talk');
    expect(root.classList.contains('clip-talk')).toBe(true);
    expect(root.classList.contains('clip-walk')).toBe(false);
  });

  it('setClip с неизвестным именем включает idle', async () => {
    const { character, root } = await mount();
    character.setClip('nope' as ClipName);
    expect(root.classList.contains('clip-idle')).toBe(true);
  });

  it('setMouth обрезает значения вне диапазона и отражает размер рта', async () => {
    const { character, root } = await mount();
    const mouth = root.querySelector('#hh-mouth-shape');

    character.setMouth(2);
    expect(root.dataset.mouth).toBe('1.000');
    const openRy = Number(mouth?.getAttribute('ry'));

    character.setMouth(-1);
    expect(root.dataset.mouth).toBe('0.000');
    const closedRy = Number(mouth?.getAttribute('ry'));

    expect(openRy).toBeGreaterThan(closedRy);
  });

  it('setFlip отражает персонажа и возвращает обратно', async () => {
    const { character, root } = await mount();
    character.setFlip(true);
    expect(root.classList.contains('flipped')).toBe(true);

    character.setFlip(false);
    expect(root.classList.contains('flipped')).toBe(false);
  });

  it('clips возвращает все клипы, включая танец', async () => {
    const { character } = await mount();
    expect(character.clips()).toEqual([
      'idle',
      'walk',
      'peek',
      'listen',
      'think',
      'work',
      'talk',
      'notify',
      'happy',
      'confused',
      'sleep',
      'dance'
    ]);
  });

  it('в клипе talk рот двигается сам, setMouth останавливает авто', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { character, root } = await mount();

    character.setClip('talk');
    vi.advanceTimersByTime(110);
    const first = root.dataset.mouth;
    vi.advanceTimersByTime(220);
    expect(root.dataset.mouth).not.toBe(first);

    character.setMouth(0.5);
    expect(root.dataset.mouth).toBe('0.500');
    vi.advanceTimersByTime(500);
    expect(root.dataset.mouth).toBe('0.500');
  });

  it('dispose очищает контейнер и останавливает таймеры', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { container, character } = await mount();

    character.setClip('talk');
    expect(container.querySelector('svg.hedgehog')).not.toBeNull();

    character.dispose();
    expect(container.querySelector('svg.hedgehog')).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
  });
});

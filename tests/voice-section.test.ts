// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/core/types';
import type { VoiceStateView } from '../src/main/ipc-settings';
import { mountVoiceSection } from '../src/renderer/settings/voice-section';

function makeConfig(): Config {
  return {
    llm: { baseUrl: '', model: '', visionModel: '' },
    voice: {
      hotkey: 'Control+Alt+Space',
      wakeWords: ['тишка'],
      wakeEnabled: false,
      talkTimeoutSec: 8,
      sensitivity: 'normal',
      mic: { threshold: null, noise: null, speech: null, calibratedAt: null },
      sttUrl: '',
      stt: { exe: '', model: '', audioCtx: 0, threads: 0 },
      tts: { enabled: false, url: '', volume: 1 }
    },
    mcpServers: [],
    persona: { fyr: 'sometimes' },
    pet: { x: null },
    petMode: false,
    screen: { enabled: true },
    web: { enabled: true }
  };
}

let check: ReturnType<typeof vi.fn>;

function install(view: VoiceStateView): void {
  check = vi.fn(async () => view);
  (window as unknown as { tishka: unknown }).tishka = {
    config: {
      get: vi.fn(async () => ({ config: makeConfig(), gatewayKeySet: true })),
      save: vi.fn(async () => undefined)
    },
    voice: {
      status: vi.fn(async () => view),
      check,
      apply: vi.fn(async () => undefined),
      dictate: vi.fn()
    }
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function buttonWith(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((item) => item.textContent === label);
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
});

describe('mountVoiceSection', () => {
  it('делит раздел на три группы с подзаголовками', async () => {
    install({ state: 'ready' });
    const root = document.createElement('div');
    mountVoiceSection(root);
    await flush();

    const titles = [...root.querySelectorAll('.group-title')].map((node) => node.textContent);
    expect(titles).toEqual(['Как звать Тишку', 'Микрофон', 'Служба распознавания']);
  });

  it('блок проверки микрофона скрыт до первой проверки', async () => {
    install({ state: 'ready' });
    const root = document.createElement('div');
    mountVoiceSection(root);
    await flush();

    expect(root.querySelector<HTMLElement>('.mic-check')?.hidden).toBe(true);
  });

  it('одна кнопка «Сохранить» внизу раздела', async () => {
    install({ state: 'ready' });
    const root = document.createElement('div');
    mountVoiceSection(root);
    await flush();

    expect(buttonWith(root, 'Сохранить')).toBeDefined();
    expect(buttonWith(root, 'Проверить')).toBeUndefined();
  });

  it('«Перезапустить службу» вызывает проверку службы', async () => {
    vi.useFakeTimers();
    install({ state: 'ready' });
    const root = document.createElement('div');
    mountVoiceSection(root);
    await flush();

    buttonWith(root, 'Перезапустить службу')!.click();
    await flush();

    expect(check).toHaveBeenCalledTimes(1);
  });
});

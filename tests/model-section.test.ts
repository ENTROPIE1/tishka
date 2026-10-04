// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayCheckResult } from '../src/core/llm/check';
import type { Config } from '../src/core/types';
import { mountModelSection } from '../src/renderer/settings/model-section';

function makeConfig(): Config {
  return {
    llm: { baseUrl: 'https://llm.example.test/v1', model: 'DKS-Lynx', visionModel: 'DKS-Vision' },
    voice: {
      hotkey: 'Control+Alt+Space',
      wakeWords: ['тишка'],
      wakeEnabled: false,
      talkByDefault: true,
      talkTimeoutSec: 30,
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
    web: { enabled: true },
    app: { warmMinutes: 30, memoryLimitMb: 1500, autostart: false }
  };
}

let checkGateway: ReturnType<typeof vi.fn>;

function install(result: GatewayCheckResult): void {
  checkGateway = vi.fn(async () => result);
  (window as unknown as { tishka: unknown }).tishka = {
    config: {
      get: vi.fn(async () => ({ config: makeConfig(), gatewayKeySet: true })),
      save: vi.fn(async () => undefined),
      checkGateway
    },
    secrets: { set: vi.fn(async () => undefined) }
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function buttonWith(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((item) => item.textContent === label);
  if (found === undefined) {
    throw new Error(`кнопка «${label}» не найдена`);
  }
  return found;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
});

describe('mountModelSection', () => {
  it('кнопка «Проверить» показывает результат и список моделей', async () => {
    vi.useFakeTimers();
    install({ ok: true, models: ['DKS-Lynx', 'DKS-Vision'], ms: 42 });
    const root = document.createElement('div');
    mountModelSection(root);
    await flush();

    buttonWith(root, 'Проверить').click();
    await flush();

    const message = root.querySelector('.message-ok')?.textContent ?? '';
    expect(message).toContain('Шлюз отвечает');
    expect(message).toContain('DKS-Lynx');
    expect(message).toContain('42');

    const options = [...root.querySelectorAll('#gateway-model-list option')].map(
      (option) => (option as HTMLOptionElement).value
    );
    expect(options).toEqual(['DKS-Lynx', 'DKS-Vision']);
    expect(checkGateway).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
  });

  it('ошибка проверки попадает в сообщение', async () => {
    vi.useFakeTimers();
    install({ ok: false, models: [], error: 'Ключ шлюза не принят', ms: 12 });
    const root = document.createElement('div');
    mountModelSection(root);
    await flush();

    buttonWith(root, 'Проверить').click();
    await flush();

    expect(root.querySelector('.message-error')?.textContent).toBe('Ключ шлюза не принят');

    await vi.runAllTimersAsync();
  });
});

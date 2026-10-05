// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayCheckResult } from '../src/core/llm/check';
import type { Config } from '../src/core/types';
import { mountModelSection } from '../src/renderer/settings/model-section';

function makeConfig(): Config {
  return {
    llm: {
      baseUrl: 'https://llm.example.test/v1',
      model: 'DKS-Lynx',
      visionModel: 'DKS-Vision',
      fallbackModel: '',
      visionFallbackModel: '',
      api: 'chat'
    },
    voice: {
      hotkey: 'Control+Alt+Space',
      wakeWords: ['тишка'],
      wakeEnabled: false,
      talkByDefault: true,
      talkTimeoutSec: 30,
      sensitivity: 'normal',
      mic: { threshold: null, noise: null, speech: null, calibratedAt: null },
      sttUrl: '',
      stt: { exe: '', model: '', audioCtx: 0, threads: 0, mode: 'remote' },
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

function inputByLabel(root: HTMLElement, label: string): HTMLInputElement {
  const fields = [...root.querySelectorAll('label.field')];
  const field = fields.find((item) => item.querySelector('.field-label')?.textContent === label);
  const input = field?.querySelector('input');
  if (input === undefined || input === null) {
    throw new Error(`поле «${label}» не найдено`);
  }
  return input;
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
  it('кнопки «Сохранить» и «Проверить» имеют общий базовый класс', async () => {
    install({ ok: true, models: [], ms: 1 });
    const root = document.createElement('div');
    mountModelSection(root);
    await flush();

    const save = buttonWith(root, 'Сохранить');
    const check = buttonWith(root, 'Проверить');

    expect(save.classList.contains('button')).toBe(true);
    expect(check.classList.contains('button')).toBe(true);
    expect(check.classList.contains('button-secondary')).toBe(true);
  });

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

  it('запасная модель показывается, сохраняется и проверяется вместе с основной', async () => {
    vi.useFakeTimers();
    const saved: Config[] = [];
    let current = makeConfig();
    install({ ok: true, models: ['DKS-Lynx', 'DKS-Backup'], ms: 10 });
    (window.tishka.config.get as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      config: current,
      gatewayKeySet: true
    }));
    (window.tishka.config.save as ReturnType<typeof vi.fn>).mockImplementation(async (config: Config) => {
      saved.push(config);
      current = config;
    });
    const root = document.createElement('div');
    mountModelSection(root);
    await flush();

    const fallback = inputByLabel(root, 'Запасная модель');
    expect(fallback.value).toBe('');
    fallback.value = 'DKS-Backup';
    fallback.dispatchEvent(new Event('input'));
    buttonWith(root, 'Сохранить').click();
    await flush();
    expect(saved[0]?.llm.fallbackModel).toBe('DKS-Backup');

    buttonWith(root, 'Проверить').click();
    await flush();
    expect(checkGateway).toHaveBeenCalledTimes(2);
    const messages = [...root.querySelectorAll('.message-ok')].map((item) => item.textContent ?? '');
    expect(messages.some((text) => text.includes('DKS-Lynx'))).toBe(true);
    expect(messages.some((text) => text.includes('Запасная модель') && text.includes('DKS-Backup'))).toBe(true);

    await vi.runAllTimersAsync();
  });

  it('формат запросов показывается, сохраняется и уходит в проверку', async () => {
    vi.useFakeTimers();
    const saved: Config[] = [];
    let current = makeConfig();
    install({ ok: true, models: ['DKS-Lynx'], ms: 10 });
    (window.tishka.config.get as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      config: current,
      gatewayKeySet: true
    }));
    (window.tishka.config.save as ReturnType<typeof vi.fn>).mockImplementation(async (config: Config) => {
      saved.push(config);
      current = config;
    });
    const root = document.createElement('div');
    mountModelSection(root);
    await flush();

    const format = root.querySelector('select');
    expect(format).not.toBeNull();
    expect([...(format as HTMLSelectElement).options].map((option) => option.textContent)).toEqual([
      'Chat Completions',
      'Responses'
    ]);
    expect((format as HTMLSelectElement).value).toBe('chat');

    (format as HTMLSelectElement).value = 'responses';
    buttonWith(root, 'Сохранить').click();
    await flush();
    expect(saved[0]?.llm.api).toBe('responses');
    expect((format as HTMLSelectElement).value).toBe('responses');

    buttonWith(root, 'Проверить').click();
    await flush();
    expect(checkGateway).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://llm.example.test/v1', api: 'responses' })
    );

    await vi.runAllTimersAsync();
  });
});

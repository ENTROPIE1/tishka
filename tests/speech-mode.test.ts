import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createToolRegistry } from '../src/core/tools/registry';
import { registerSpeechModeTool, type SpeechModeDeps } from '../src/core/tools/speech-mode';
import type { Config } from '../src/core/types';
import { cleanupCores, replyChoice, setupCore, toolChoice } from './core-helpers';

function makeDeps(overrides: Partial<SpeechModeDeps> = {}): SpeechModeDeps {
  return {
    setEnabled: vi.fn(async () => undefined),
    stopSpeaking: vi.fn(),
    voiceAvailable: vi.fn(async () => true),
    ...overrides
  };
}

function registryFor(deps: SpeechModeDeps) {
  const registry = createToolRegistry(createEventBus());
  registerSpeechModeTool(registry, deps);
  return registry;
}

afterEach(async () => {
  await cleanupCores();
});

describe('инструмент speech_mode', () => {
  it('text выключает синтез, останавливает речь и отвечает молча', async () => {
    const setEnabled = vi.fn(async () => undefined);
    const stopSpeaking = vi.fn();
    const registry = registryFor(makeDeps({ setEnabled, stopSpeaking }));

    const result = await registry.call('speech_mode', { mode: 'text' });

    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(stopSpeaking).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.reply).toEqual({ say: 'Хорошо, пишу молча', mood: 'neutral' });
  });

  it('voice включает синтез и подтверждает вслух', async () => {
    const setEnabled = vi.fn(async () => undefined);
    const registry = registryFor(makeDeps({ setEnabled, voiceAvailable: async () => true }));

    const result = await registry.call('speech_mode', { mode: 'voice' });

    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(result.reply).toEqual({ say: 'Хорошо, говорю вслух', mood: 'happy' });
  });

  it('недоступная служба синтеза: настройка включается, ответ честный', async () => {
    const setEnabled = vi.fn(async () => undefined);
    const registry = registryFor(makeDeps({ setEnabled, voiceAvailable: async () => false }));

    const result = await registry.call('speech_mode', { mode: 'voice' });

    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(result.reply?.say).toBe('Голос сейчас недоступен, пишу текстом');
  });

  it('неизвестный режим — понятная ошибка', async () => {
    const deps = makeDeps();
    const registry = registryFor(deps);

    const result = await registry.call('speech_mode', { mode: 'loud' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('voice');
    expect(deps.setEnabled).not.toHaveBeenCalled();
  });
});

function enabledConfig(): Config {
  const voice = { tts: { enabled: true } };
  return { voice } as unknown as Config;
}

describe('speech_mode действует без перезапуска', () => {
  it('ядро меняет voice.tts.enabled и оповещает о смене настроек', async () => {
    const stopSpeaking = vi.fn();
    const changed: boolean[] = [];
    const fetchMock = vi.fn<typeof fetch>(async () => toolChoice('c1', 'speech_mode', { mode: 'text' }));
    const { core } = await setupCore({
      fetch: fetchMock,
      config: enabledConfig(),
      stopSpeaking,
      voiceAvailable: async () => true,
      onConfigChanged: (_previous, next) => changed.push(next.voice.tts.enabled)
    });

    await core.handleUserText('помолчи');

    expect(core.config().voice.tts.enabled).toBe(false);
    expect(stopSpeaking).toHaveBeenCalledOnce();
    expect(changed).toEqual([false]);
  });

  it('включение голоса сохраняется в настройку', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => toolChoice('c1', 'speech_mode', { mode: 'voice' }));
    const { core, dataDir } = await setupCore({
      fetch: fetchMock,
      voiceAvailable: async () => true
    });

    await core.handleUserText('говори голосом');

    expect(core.config().voice.tts.enabled).toBe(true);
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(`${dataDir}/config.json`, 'utf8'));
    expect((JSON.parse(raw) as Config).voice.tts.enabled).toBe(true);
  });
});

describe('режим ответа виден в подсказке', () => {
  it('системное сообщение несёт режим и способ реплики', async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(String(init?.body));
      return replyChoice(`r${bodies.length}`, 'ок');
    });
    const { core } = await setupCore({ fetch: fetchMock });

    await core.handleUserText('привет', 'voice');

    expect(bodies[0]).toContain('только текстом');
    expect(bodies[0]).toContain('Реплика человека пришла голосом');
    expect(bodies[0]).toContain('speech_mode');
  });
});

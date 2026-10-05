import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/core/types';
import type { SttService } from '../src/voice/stt-service';
import { restartVoiceIfNeeded, voiceRestartNeeded } from '../src/main/voice-restart';

type SttMode = Config['voice']['stt']['mode'];

function config(mode: SttMode, exe = '', model = '', sttUrl = 'http://127.0.0.1:8178'): Config {
  return {
    llm: { baseUrl: '', model: '', visionModel: '', fallbackModel: '', visionFallbackModel: '', api: 'chat' },
    voice: {
      hotkey: 'Control+Alt+Space',
      wakeWords: ['тишка'],
      wakeEnabled: false,
      talkByDefault: true,
      talkTimeoutSec: 8,
      sensitivity: 'normal',
      mic: { threshold: null, noise: null, speech: null, calibratedAt: null },
      sttUrl,
      stt: { exe, model, audioCtx: 768, threads: 4, mode },
      tts: { enabled: false, url: '', volume: 1 }
    },
    mcpServers: [],
    persona: { fyr: 'sometimes', character: 'hedgehog' },
    pet: { x: null },
    petMode: false,
    screen: { enabled: true },
    web: { enabled: true },
    app: { warmMinutes: 30, memoryLimitMb: 1500, autostart: false }
  };
}

function fakeStt(): SttService {
  return {
    start: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(),
    transcribe: vi.fn(),
    status: vi.fn(() => 'off' as const),
    pid: vi.fn()
  } as unknown as SttService;
}

describe('voiceRestartNeeded', () => {
  it('переключение варианта требует перезапуска', () => {
    expect(voiceRestartNeeded(config('local', 'C:\\w\\whisper.exe'), config('remote', 'C:\\w\\whisper.exe'))).toBe(true);
  });

  it('смена адреса требует перезапуска', () => {
    expect(voiceRestartNeeded(config('remote'), config('remote', '', '', 'http://127.0.0.1:9999'))).toBe(true);
  });

  it('без изменений перезапуск не нужен', () => {
    expect(voiceRestartNeeded(config('remote'), config('remote'))).toBe(false);
  });
});

describe('restartVoiceIfNeeded', () => {
  it('останавливает прежнюю службу и запускает новую при переходе на готовую', async () => {
    const stt = fakeStt();
    const applied = restartVoiceIfNeeded(stt, config('local', 'C:\\w\\whisper.exe'), config('remote', 'C:\\w\\whisper.exe'));

    expect(applied).toBe(true);
    expect(stt.stop).toHaveBeenCalledTimes(1);
    expect(stt.start).toHaveBeenCalledTimes(1);
  });

  it('запускает местную службу при переходе обратно', async () => {
    const stt = fakeStt();
    restartVoiceIfNeeded(stt, config('remote'), config('local', 'C:\\w\\whisper.exe'));

    expect(stt.stop).toHaveBeenCalledTimes(1);
    expect(stt.start).toHaveBeenCalledTimes(1);
  });

  it('без изменений служба не трогается', () => {
    const stt = fakeStt();
    const applied = restartVoiceIfNeeded(stt, config('remote'), config('remote'));

    expect(applied).toBe(false);
    expect(stt.stop).not.toHaveBeenCalled();
    expect(stt.start).not.toHaveBeenCalled();
  });
});

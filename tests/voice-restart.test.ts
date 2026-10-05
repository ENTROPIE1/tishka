import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/core/types';
import type { SttService } from '../src/voice/stt-service';
import { restartVoiceIfNeeded, voiceRestartNeeded } from '../src/main/voice-restart';

type SttMode = Config['voice']['stt']['mode'];

function config(mode: SttMode, exe = '', model = '', sttUrl = 'http://127.0.0.1:8178'): Config {
  return {
    llm: { baseUrl: '', model: '', visionModel: '', api: 'chat' },
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
    persona: { fyr: 'sometimes' },
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

  it('успешный перезапуск завершает отложенное включение записи', async () => {
    const stt = fakeStt();
    const onReady = vi.fn();
    const onFailed = vi.fn();
    restartVoiceIfNeeded(stt, config('local', 'C:\\w\\whisper.exe'), config('remote'), { onReady, onFailed });

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('неудачный перезапуск сообщает о неудаче', async () => {
    const stt = fakeStt();
    (stt.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'нет файла' });
    const onReady = vi.fn();
    const onFailed = vi.fn();
    restartVoiceIfNeeded(stt, config('local', 'C:\\w\\whisper.exe'), config('remote'), { onReady, onFailed });

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith('нет файла'));
    expect(onReady).not.toHaveBeenCalled();
  });

  it('отменённый перезапуск неудачей не считается', async () => {
    const stt = fakeStt();
    (stt.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'Запуск отменён' });
    const onReady = vi.fn();
    const onFailed = vi.fn();
    restartVoiceIfNeeded(stt, config('local', 'C:\\w\\whisper.exe'), config('remote'), { onReady, onFailed });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onReady).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });
});

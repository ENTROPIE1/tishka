import { describe, expect, it } from 'vitest';
import { buildServiceArgs, detectorState, findVadModel, parseHelpCaps } from '../src/voice/stt-flags';

const HELP = [
  'usage: whisper-server [options]',
  '  -sns, --suppress-nst       suppress non-speech tokens',
  '  --vad, --vad-model FNAME   enable VAD with the given model'
].join('\n');

describe('parseHelpCaps', () => {
  it('видит -sns и --vad в справке', () => {
    expect(parseHelpCaps(HELP)).toEqual({ suppressNst: true, vad: true });
  });

  it('старая сборка без ключей — ничего не поддерживается', () => {
    expect(parseHelpCaps('usage: whisper-server [options]\n  -m FNAME  model')).toEqual({
      suppressNst: false,
      vad: false
    });
  });

  it('--vad-model без --vad ключом --vad не считается', () => {
    expect(parseHelpCaps('  --vad-model FNAME')).toEqual({ suppressNst: false, vad: false });
  });
});

describe('buildServiceArgs', () => {
  const base = ['-m', 'model.bin'];

  it('добавляет -sns и детектор, когда они поддержаны', () => {
    const caps = { suppressNst: true, vad: true };
    expect(buildServiceArgs(base, caps, 'ggml-silero.bin')).toEqual([
      '-m', 'model.bin', '-sns', '--vad', '--vad-model', 'ggml-silero.bin'
    ]);
  });

  it('без справки запускает как раньше и не ставит -mc 0', () => {
    const caps = { suppressNst: false, vad: false };
    expect(buildServiceArgs(base, caps, undefined)).toEqual(base);
    expect(buildServiceArgs(base, caps, undefined)).not.toContain('-mc');
  });

  it('поддержан --vad, но модели нет — только -sns', () => {
    expect(buildServiceArgs(base, { suppressNst: true, vad: true }, undefined)).toEqual(['-m', 'model.bin', '-sns']);
  });
});

describe('findVadModel', () => {
  it('находит ggml-silero рядом с моделью', () => {
    const list = (): string[] => ['ggml-small.bin', 'ggml-silero-v5.1.2.bin'];
    expect(findVadModel('C:\\w\\ggml-small.bin', list)).toBe('C:\\w\\ggml-silero-v5.1.2.bin');
  });

  it('нет файла — undefined', () => {
    expect(findVadModel('C:\\w\\ggml-small.bin', () => ['ggml-small.bin'])).toBeUndefined();
  });

  it('каталог недоступен — undefined, без исключения', () => {
    const list = (): string[] => {
      throw new Error('нет каталога');
    };
    expect(findVadModel('C:\\w\\ggml-small.bin', list)).toBeUndefined();
  });
});

describe('detectorState', () => {
  it('включён, нет модели, выключен', () => {
    expect(detectorState({ suppressNst: false, vad: true }, 'ggml-silero.bin')).toBe('on');
    expect(detectorState({ suppressNst: false, vad: true }, undefined)).toBe('no-model');
    expect(detectorState({ suppressNst: false, vad: false }, undefined)).toBe('off');
  });
});

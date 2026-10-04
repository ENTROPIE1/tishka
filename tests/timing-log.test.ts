import { describe, expect, it, vi } from 'vitest';
import { createTimingLog, formatDetails, formatTimingLine } from '../src/main/timing-log';

function collector(): { lines: string[]; write: (path: string, text: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    write: (_path: string, text: string): void => {
      lines.push(text.trimEnd());
    }
  };
}

describe('formatTimingLine', () => {
  it('ставит время ISO, отсчёты от старта и от прошлой отметки, событие и детали', () => {
    const line = formatTimingLine(Date.UTC(2026, 9, 4, 12, 0, 0), 1500, 500, 'stt.ready', { ms: 42, ok: true });
    expect(line).toBe('2026-10-04T12:00:00.000Z +1500ms +500ms stt.ready ms=42 ok=true');
  });

  it('без деталей лишних пробелов нет', () => {
    expect(formatTimingLine(0, 0, 0, 'start')).toBe('1970-01-01T00:00:00.000Z +0ms +0ms start');
  });

  it('переносы строк в деталях заменяются пробелами', () => {
    expect(formatDetails({ reason: 'a\nb\tc' })).toBe(' reason=a b c');
  });
});

describe('createTimingLog', () => {
  it('при создании пишет строку-разделитель с версией', () => {
    const { lines, write } = collector();
    createTimingLog({ filePath: 'timing.log', version: '1.2.3', startedAt: 0, now: () => 0, write });
    expect(lines[0]).toContain('--- timing start');
    expect(lines[0]).toContain('version=1.2.3');
  });

  it('считает миллисекунды от старта и от предыдущей отметки', () => {
    const { lines, write } = collector();
    let at = 1000;
    const log = createTimingLog({ filePath: 'timing.log', version: 'v', startedAt: 1000, now: () => at, write });
    at = 2500;
    log.mark('process.start');
    at = 3000;
    log.mark('app.ready');
    expect(lines[1]).toContain('+1500ms +1500ms process.start');
    expect(lines[2]).toContain('+2000ms +500ms app.ready');
  });

  it('обрезает файл, если он больше предела', () => {
    const { write } = collector();
    const reset = vi.fn();
    const log = createTimingLog({
      filePath: 'timing.log',
      version: 'v',
      startedAt: 0,
      now: () => 1,
      maxBytes: 10,
      size: () => 100,
      resetFile: reset,
      write
    });
    log.mark('x');
    expect(reset).toHaveBeenCalledWith('timing.log');
  });

  it('сбой записи не выбрасывает исключение и не мешает следующей отметке', () => {
    let calls = 0;
    const write = (): void => {
      calls += 1;
      throw new Error('disk full');
    };
    const log = createTimingLog({ filePath: 'timing.log', version: 'v', startedAt: 0, now: () => 1, write });
    expect(() => log.mark('a')).not.toThrow();
    expect(() => log.mark('b')).not.toThrow();
    expect(calls).toBe(3);
  });

  it('сбой определения размера не выбрасывает исключение', () => {
    const { write } = collector();
    const log = createTimingLog({
      filePath: 'timing.log',
      version: 'v',
      startedAt: 0,
      now: () => 1,
      size: () => {
        throw new Error('no file');
      },
      write
    });
    expect(() => log.mark('a')).not.toThrow();
  });
});

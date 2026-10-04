import { describe, expect, it, vi } from 'vitest';
import { createProcessMemory, parseTasklistMemory } from '../src/main/process-memory';

const EXPECTED = Math.round(612340 / 1024);

describe('parseTasklistMemory', () => {
  it('разбирает число с пробелом-разделителем', () => {
    expect(parseTasklistMemory('"whisper-server.exe","1234","Console","1","612 340 K"')).toBe(EXPECTED);
  });

  it('разбирает неразрывный пробел', () => {
    expect(parseTasklistMemory('"whisper-server.exe","1234","Console","1","612\u00A0340 K"')).toBe(EXPECTED);
  });

  it('разбирает запятую в роли разделителя', () => {
    expect(parseTasklistMemory('"whisper-server.exe","1234","Console","1","612,340 K"')).toBe(EXPECTED);
  });

  it('разбирает точку в роли разделителя и кириллическую единицу', () => {
    expect(parseTasklistMemory('"whisper-server.exe","1234","Console","1","612.340 КБ"')).toBe(EXPECTED);
  });

  it('разбирает строку со знаками замены вместо разделителя и единицы', () => {
    expect(parseTasklistMemory('"whisper-server.exe","1234","Console","1","76\uFFFD040 \uFFFD\uFFFD"')).toBe(
      Math.round(76040 / 1024),
    );
  });

  it('поле без цифр — ноль', () => {
    expect(parseTasklistMemory('"whisper-server.exe","1234","Console","1","\uFFFD\uFFFD \uFFFD"')).toBe(0);
  });

  it('строка не из пяти полей — ноль', () => {
    expect(parseTasklistMemory('"whisper-server.exe","1234","Console","612 340 K"')).toBe(0);
  });

  it('строка без процессов — ноль', () => {
    expect(parseTasklistMemory('INFO: No tasks are running which match the specified criteria.')).toBe(0);
  });

  it('пустой вывод — ноль', () => {
    expect(parseTasklistMemory('')).toBe(0);
  });
});

describe('createProcessMemory', () => {
  it('обновляет не чаще раза в 30 секунд', async () => {
    let at = 0;
    const run = vi.fn(async () => '"whisper-server.exe","7","Console","1","2048 K"');
    const memory = createProcessMemory({ getPid: () => 7, run, now: () => at, platform: 'win32' });

    await memory.refresh();
    expect(run).toHaveBeenCalledTimes(1);
    expect(memory.current()).toBe(2);

    at = 29999;
    await memory.refresh();
    expect(run).toHaveBeenCalledTimes(1);

    at = 30000;
    await memory.refresh();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('ошибка запуска — ноль', async () => {
    const run = vi.fn(async () => {
      throw new Error('tasklist failed');
    });
    const memory = createProcessMemory({ getPid: () => 7, run, platform: 'win32' });

    await memory.refresh();
    expect(memory.current()).toBe(0);
  });

  it('нет процесса — команда не запускается, ноль', async () => {
    const run = vi.fn(async () => '"x","1","Console","1","2048 K"');
    const memory = createProcessMemory({ getPid: () => undefined, run, platform: 'win32' });

    await memory.refresh();
    expect(run).not.toHaveBeenCalled();
    expect(memory.current()).toBe(0);
  });

  it('другая система — ноль', async () => {
    const run = vi.fn(async () => '"x","1","Console","1","2048 K"');
    const memory = createProcessMemory({ getPid: () => 7, run, platform: 'linux' });

    await memory.refresh();
    expect(run).not.toHaveBeenCalled();
    expect(memory.current()).toBe(0);
  });
});

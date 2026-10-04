import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createHistory, type HistoryEntry, type HistoryMessage } from '../src/core/history';
import type { EventBus } from '../src/core/types';

const FIXED_NOW = new Date('2026-10-02T12:30:00');

function messages(entries: HistoryEntry[]): HistoryMessage[] {
  return entries.filter((entry): entry is HistoryMessage => entry.kind === 'message');
}

const pendingDirs: string[] = [];

afterEach(async () => {
  while (pendingDirs.length > 0) {
    const dir = pendingDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function tempHistoryPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tishka-history-'));
  pendingDirs.push(dir);
  return join(dir, 'history.jsonl');
}

function emitReply(bus: EventBus, say: string): void {
  bus.emit({ type: 'reply', reply: { say, mood: 'happy' } });
}

describe('createHistory', () => {
  it('события дают записи в правильном порядке и с правильными полями', async () => {
    const bus = createEventBus();
    const history = createHistory(await tempHistoryPath(), bus, () => FIXED_NOW);
    await history.start();

    bus.emit({ type: 'listen.end', text: 'утро пятницы' });
    bus.emit({
      type: 'reply',
      reply: {
        say: 'Открыл всё для пятницы',
        show: { kind: 'text', title: 'План', markdown: '# План\n- раз' },
        mood: 'happy'
      }
    });
    bus.emit({ type: 'notify', title: 'Напоминание: выпить воды' });
    bus.emit({ type: 'error', message: 'Сервер недоступен' });
    bus.emit({ type: 'wake', source: 'name' });
    bus.emit({ type: 'idle' });

    const entries = history.list();
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      from: 'user',
      text: 'утро пятницы',
      at: FIXED_NOW.toISOString()
    });
    expect(entries[1]).toMatchObject({
      from: 'tishka',
      text: 'Открыл всё для пятницы',
      panel: { kind: 'text', title: 'План', markdown: '# План\n- раз' },
      mood: 'happy'
    });
    expect(entries[2]).toMatchObject({ from: 'system', text: 'Напоминание: выпить воды' });
    expect(entries[3]).toMatchObject({ from: 'system', text: 'Сервер недоступен' });
    expect(entries[0]?.id).not.toBe(entries[1]?.id);
  });

  it('list отдаёт последние записи с учётом лимита', async () => {
    const bus = createEventBus();
    const history = createHistory(await tempHistoryPath(), bus, () => FIXED_NOW);
    await history.start();

    emitReply(bus, 'первый');
    emitReply(bus, 'второй');
    emitReply(bus, 'третий');

    expect(messages(history.list(2)).map((entry) => entry.text)).toEqual(['второй', 'третий']);
  });

  it('история переживает перезапуск: новый экземпляр на том же файле видит записи', async () => {
    const file = await tempHistoryPath();
    const firstBus = createEventBus();
    const first = createHistory(file, firstBus, () => FIXED_NOW);
    await first.start();
    firstBus.emit({ type: 'listen.end', text: 'привет' });
    emitReply(firstBus, 'и тебе привет');
    first.stop();

    const secondBus = createEventBus();
    const second = createHistory(file, secondBus, () => FIXED_NOW);
    await second.start();

    const entries = second.list();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ from: 'user', text: 'привет' });
    expect(entries[1]).toMatchObject({ from: 'tishka', text: 'и тебе привет' });
    second.stop();
  });

  it('повреждённая строка в файле пропускается', async () => {
    const file = await tempHistoryPath();
    const good = { id: 'a', at: FIXED_NOW.toISOString(), from: 'user', text: 'привет' };
    await writeFile(
      file,
      `${JSON.stringify(good)}\nэто не json{\n{"broken": true}\n${JSON.stringify(good)}\n`,
      'utf8'
    );

    const history = createHistory(file, createEventBus(), () => FIXED_NOW);
    await history.start();

    const entries = history.list();
    expect(entries).toHaveLength(2);
    expect(messages(entries).every((entry) => entry.text === 'привет')).toBe(true);
    history.stop();
  });

  it('файл из 2100 строк при запуске сокращается до 1000 последних', async () => {
    const file = await tempHistoryPath();
    const lines: string[] = [];
    for (let index = 0; index < 2100; index += 1) {
      lines.push(
        JSON.stringify({
          id: `id-${index}`,
          at: FIXED_NOW.toISOString(),
          from: 'user',
          text: `строка ${index}`
        })
      );
    }
    await writeFile(file, `${lines.join('\n')}\n`, 'utf8');

    const history = createHistory(file, createEventBus(), () => FIXED_NOW);
    await history.start();

    const entries = history.list(1000);
    expect(entries).toHaveLength(1000);
    expect(entries[0]).toMatchObject({ text: 'строка 1100' });
    expect(entries.at(-1)).toMatchObject({ text: 'строка 2099' });

    const raw = await readFile(file, 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1000);
    history.stop();
  });

  it('clear() очищает список и файл', async () => {
    const bus = createEventBus();
    const file = await tempHistoryPath();
    const history = createHistory(file, bus, () => FIXED_NOW);
    await history.start();
    bus.emit({ type: 'listen.end', text: 'привет' });
    expect(history.list()).toHaveLength(1);

    await history.clear();

    expect(history.list()).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe('');
    history.stop();
  });

  it('addDivider пишет разделитель в список и файл', async () => {
    const file = await tempHistoryPath();
    const history = createHistory(file, createEventBus(), () => FIXED_NOW);
    await history.start();

    history.addDivider();

    const entries = history.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'divider', at: FIXED_NOW.toISOString() });

    const raw = await readFile(file, 'utf8');
    expect(JSON.parse(raw.trim())).toMatchObject({ kind: 'divider', at: FIXED_NOW.toISOString() });
    history.stop();
  });

  it('разделитель переживает перезапуск', async () => {
    const file = await tempHistoryPath();
    const first = createHistory(file, createEventBus(), () => FIXED_NOW);
    await first.start();
    first.addDivider();
    first.stop();

    const second = createHistory(file, createEventBus(), () => FIXED_NOW);
    await second.start();

    expect(second.list()[0]).toMatchObject({ kind: 'divider' });
    second.stop();
  });

  it('search находит без учёта регистра и «ё/е», новые первыми, соблюдает предел', async () => {
    const bus = createEventBus();
    const history = createHistory(await tempHistoryPath(), bus, () => FIXED_NOW);
    await history.start();

    bus.emit({ type: 'listen.end', text: 'ёлка и подарки' });
    bus.emit({ type: 'reply', reply: { say: 'Ёлка большая' } });
    bus.emit({ type: 'listen.end', text: 'ёщё раз про ёлку' });

    expect(history.search('ЕЛКА')).toHaveLength(2);
    const found = history.search('елку', 1);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ text: 'ёщё раз про ёлку' });
    history.stop();
  });

  it('search ищет в заголовках и содержимом карточек', async () => {
    const bus = createEventBus();
    const history = createHistory(await tempHistoryPath(), bus, () => FIXED_NOW);
    await history.start();

    bus.emit({
      type: 'reply',
      reply: {
        say: 'Готово',
        show: { kind: 'text', title: 'Заметка', markdown: 'секретный пароль от склада' }
      }
    });

    const found = history.search('склад');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ text: 'Готово' });
    history.stop();
  });

  it('пустой запрос возвращает пустой список, разделитель не попадает в результаты', async () => {
    const bus = createEventBus();
    const history = createHistory(await tempHistoryPath(), bus, () => FIXED_NOW);
    await history.start();
    history.addDivider();
    bus.emit({ type: 'listen.end', text: 'привет' });

    expect(history.search('   ')).toEqual([]);
    expect(history.search('привет').every((entry) => entry.kind === 'message')).toBe(true);
    history.stop();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryRecord } from '../src/core/memory/types';
import type { TishkaEvent } from '../src/core/types';
import { memoryDate, mountMemorySection } from '../src/renderer/settings/memory-section';

type Listener = (event: TishkaEvent) => void;

interface FakeMemory {
  list: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

let memory: FakeMemory;
let listeners: Listener[];

function record(id: string, text: string, updated: string, tags: string[] = []): MemoryRecord {
  return { id, text, tags, created: updated, updated, source: 'user' };
}

function install(records: MemoryRecord[]): void {
  memory = {
    list: vi.fn(async () => records),
    search: vi.fn(async () => records),
    update: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined)
  };
  listeners = [];
  (window as unknown as { tishka: unknown }).tishka = {
    memory,
    onEvent: (listener: Listener) => {
      listeners.push(listener);
      return () => undefined;
    }
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
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
});

describe('memoryDate', () => {
  const now = new Date('2026-10-04T12:00:00');

  it('для текущего дня показывает «сегодня, время»', () => {
    expect(memoryDate('2026-10-04T09:47:00', now)).toBe('сегодня, 9:47');
  });

  it('для другого дня показывает число и месяц', () => {
    expect(memoryDate('2026-09-03T08:00:00', now)).toBe('3 сентября');
  });

  it('на некорректной дате возвращает пустую строку', () => {
    expect(memoryDate('', now)).toBe('');
  });
});

describe('mountMemorySection', () => {
  it('показывает новые записи сверху и подписывает их датой', async () => {
    install([
      record('1', 'старая', '2026-09-01T10:00:00'),
      record('2', 'новая', '2026-10-03T10:00:00')
    ]);
    const root = document.createElement('div');
    mountMemorySection(root);
    await flush();

    const texts = [...root.querySelectorAll('.memory-item-text')].map((node) => node.textContent);
    expect(texts).toEqual(['новая', 'старая']);
    expect(root.querySelector('.memory-item-meta')?.textContent).toContain(memoryDate('2026-10-03T10:00:00'));
  });

  it('обновление не затирает открытый редактор и введённый текст', async () => {
    install([record('1', 'запись', '2026-10-03T10:00:00')]);
    const root = document.createElement('div');
    const section = mountMemorySection(root);
    await flush();

    buttonWith(root, 'Изменить').click();
    const text = root.querySelector('textarea') as HTMLTextAreaElement;
    text.value = 'черновик';
    section.refresh();
    await flush();

    expect(root.querySelector('.editor')).not.toBeNull();
    expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('черновик');
  });

  it('событие memory.changed обновляет открытый экран', async () => {
    install([record('1', 'первая', '2026-10-03T10:00:00')]);
    const root = document.createElement('div');
    mountMemorySection(root);
    await flush();
    expect(root.textContent).toContain('первая');

    memory.list.mockResolvedValueOnce([record('2', 'вторая', '2026-10-04T10:00:00')]);
    for (const listener of listeners) {
      listener({ type: 'memory.changed' });
    }
    await flush();

    expect(root.textContent).toContain('вторая');
  });
});

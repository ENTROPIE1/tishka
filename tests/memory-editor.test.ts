// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryRecord } from '../src/core/memory/types';
import type { TishkaEvent } from '../src/core/types';
import { mountMemorySection } from '../src/renderer/settings/memory-section';

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

function record(id: string, text: string, updated: string): MemoryRecord {
  return { id, text, tags: [], created: updated, updated, source: 'user' };
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

async function mount(records: MemoryRecord[]): Promise<HTMLElement> {
  install(records);
  const root = document.createElement('div');
  document.body.append(root);
  mountMemorySection(root);
  await flush();
  return root;
}

async function open(root: HTMLElement, text = 'новое'): Promise<void> {
  buttonWith(root, 'Изменить').click();
  (root.querySelector('textarea') as HTMLTextAreaElement).value = text;
}

afterEach(() => {
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
});

describe('редактор записи памяти', () => {
  it('сохранение закрывает редактор и показывает обновлённый список', async () => {
    const root = await mount([record('1', 'старое', '2026-10-03T10:00:00')]);
    await open(root);
    memory.list
      .mockResolvedValueOnce([record('1', 'старое', '2026-10-03T10:00:00')])
      .mockResolvedValueOnce([record('1', 'новое', '2026-10-04T10:00:00')]);
    buttonWith(root, 'Сохранить').click();
    await flush();

    expect(memory.update).toHaveBeenCalledWith('1', { text: 'новое', tags: [] });
    expect(root.querySelector('.editor')).toBeNull();
    expect(root.querySelector('.message-ok')?.textContent).toContain('Запись обновлена');
    expect(root.querySelector('.memory-item-text')?.textContent).toBe('новое');
  });

  it('ошибка сохранения оставляет редактор открытым с текстом ошибки', async () => {
    const root = await mount([record('1', 'старое', '2026-10-03T10:00:00')]);
    await open(root);
    memory.update.mockRejectedValueOnce(new Error('Шлюз недоступен'));
    buttonWith(root, 'Сохранить').click();
    await flush();

    expect(root.querySelector('.editor')).not.toBeNull();
    expect(root.querySelector('.message-error')?.textContent).toContain('Шлюз недоступен');
  });

  it('отмена и Esc закрывают редактор без сохранения', async () => {
    const root = await mount([record('1', 'запись', '2026-10-03T10:00:00')]);
    await open(root);
    buttonWith(root, 'Отмена').click();
    await flush();
    expect(root.querySelector('.editor')).toBeNull();
    expect(root.querySelector('.memory-item-text')?.textContent).toBe('запись');

    await open(root);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(root.querySelector('.editor')).toBeNull();
    expect(memory.update).not.toHaveBeenCalled();
  });

  it('пустой текст не сохраняется и показывает подсказку', async () => {
    const root = await mount([record('1', 'запись', '2026-10-03T10:00:00')]);
    await open(root, '   ');
    buttonWith(root, 'Сохранить').click();
    await flush();

    expect(memory.update).not.toHaveBeenCalled();
    expect(root.querySelector('.editor')).not.toBeNull();
    expect(root.querySelector('.field-hint')?.textContent).toContain('пуст');
  });

  it('memory.changed при открытом редакторе не теряет введённое, после закрытия список свежий', async () => {
    const root = await mount([record('1', 'старое', '2026-10-03T10:00:00')]);
    await open(root, 'черновик');
    memory.list.mockResolvedValue([record('1', 'внешнее', '2026-10-04T10:00:00')]);
    for (const listener of listeners) {
      listener({ type: 'memory.changed' });
    }
    await flush();

    expect(root.querySelector('.editor')).not.toBeNull();
    expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('черновик');

    buttonWith(root, 'Отмена').click();
    await flush();
    expect(root.textContent).toContain('внешнее');
  });

  it('изменённую извне запись сохранить нельзя, правка остаётся', async () => {
    const root = await mount([record('1', 'старое', '2026-10-03T10:00:00')]);
    await open(root, 'правка');
    memory.list.mockResolvedValueOnce([record('1', 'другое', '2026-10-04T09:00:00')]);
    buttonWith(root, 'Сохранить').click();
    await flush();

    expect(memory.update).not.toHaveBeenCalled();
    expect(root.querySelector('.editor')).not.toBeNull();
    expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('правка');
    expect(root.querySelector('.message-error')?.textContent).toContain('изменилась');
  });

  it('удалённую извне запись не сохраняем и не теряем правку', async () => {
    const root = await mount([record('1', 'старое', '2026-10-03T10:00:00')]);
    await open(root, 'правка');
    memory.list.mockResolvedValueOnce([]);
    buttonWith(root, 'Сохранить').click();
    await flush();

    expect(memory.update).not.toHaveBeenCalled();
    expect(root.querySelector('.editor')).not.toBeNull();
    expect(root.querySelector('.message-error')?.textContent).toContain('удалена');
  });
});

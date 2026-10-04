// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '../src/core/types';
import { panelElement } from '../src/renderer/shared/panels';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function copyButton(card: HTMLElement): HTMLButtonElement {
  const button = card.querySelector<HTMLButtonElement>('.card-copy');
  if (button === null) {
    throw new Error('Кнопка копирования не найдена');
  }
  return button;
}

function clickCopy(card: HTMLElement): void {
  copyButton(card).click();
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('panelElement: копирование', () => {
  it('текстовая карточка кладёт html и plain, заголовок в html не попадает', () => {
    const panel: Panel = { kind: 'text', title: 'Итог недели', markdown: '## Итог\n- **Сделано**: отчёт' };
    const onCopyRich = vi.fn<(html: string, text: string) => void>();
    const card = panelElement(panel, { onCopyRich });

    clickCopy(card);

    expect(onCopyRich).toHaveBeenCalledOnce();
    const [html, text] = onCopyRich.mock.calls[0];
    expect(html).toContain('<h2>Итог</h2>');
    expect(html).toContain('<strong>Сделано</strong>');
    expect(html).not.toContain('Итог недели');
    expect(text).toBe('Итог\n• Сделано: отчёт');
  });

  it('карточка списка копируется как раньше через onCopy', () => {
    const panel: Panel = { kind: 'list', title: 'Встречи', items: [{ title: 'Планёрка', subtitle: '10:00' }] };
    const onCopy = vi.fn<(text: string) => void>();
    const onCopyRich = vi.fn<(html: string, text: string) => void>();
    const card = panelElement(panel, { onCopy, onCopyRich });

    clickCopy(card);

    expect(onCopy).toHaveBeenCalledWith('Планёрка\n10:00');
    expect(onCopyRich).not.toHaveBeenCalled();
  });

  it('карточка image кладёт в буфер картинку, а не путь', () => {
    const panel: Panel = { kind: 'image', title: 'Снимок экрана', path: 'C:/shots/снимок.png' };
    const onCopy = vi.fn<(text: string) => void>();
    const onCopyImage = vi.fn<(path: string) => void>();
    const card = panelElement(panel, { onCopy, onCopyImage });

    clickCopy(card);

    expect(onCopyImage).toHaveBeenCalledWith('C:/shots/снимок.png');
    expect(onCopy).not.toHaveBeenCalled();
  });
});

describe('panelElement: сообщение о копировании', () => {
  it('успех показывает «Скопировано»', async () => {
    const panel: Panel = { kind: 'text', title: 'Итог', markdown: '**важно**' };
    const onCopyRich = vi.fn(() => Promise.resolve());
    const onCopy = vi.fn(() => Promise.resolve());
    const card = panelElement(panel, { onCopy, onCopyRich });

    clickCopy(card);
    await tick();

    expect(copyButton(card).textContent).toBe('Скопировано');
  });

  it('сбой оформления и успех текста показывает «Скопировано»', async () => {
    const panel: Panel = { kind: 'text', title: 'Итог', markdown: '**важно**' };
    const onCopyRich = vi.fn(() => Promise.reject(new Error('нет html')));
    const onCopy = vi.fn(() => Promise.resolve());
    const card = panelElement(panel, { onCopy, onCopyRich });

    clickCopy(card);
    await tick();

    expect(onCopy).toHaveBeenCalledOnce();
    expect(copyButton(card).textContent).toBe('Скопировано');
  });

  it('сбой обоих способов показывает «Не удалось скопировать»', async () => {
    const panel: Panel = { kind: 'text', title: 'Итог', markdown: '**важно**' };
    const onCopyRich = vi.fn(() => Promise.reject(new Error('нет html')));
    const onCopy = vi.fn(() => Promise.reject(new Error('нет текста')));
    const card = panelElement(panel, { onCopy, onCopyRich });

    clickCopy(card);
    await tick();

    expect(copyButton(card).textContent).toBe('Не удалось скопировать');
  });
});

describe('panelElement: адрес картинки', () => {
  function imageSrc(path: string): string {
    const panel: Panel = { kind: 'image', title: 'Снимок', path };
    const card = panelElement(panel, {});
    const img = card.querySelector<HTMLImageElement>('img');
    if (img === null) {
      throw new Error('Картинка не найдена');
    }
    return img.src;
  }

  it('кодирует #, % и ? в имени файла', () => {
    const src = imageSrc('C:/shots/итог #1%?.png');

    expect(src).toContain('file:///C:/shots/');
    expect(src).not.toContain('#');
    expect(src).not.toContain('?');
    expect(src).toContain('%23');
    expect(src).toContain('%25');
    expect(src).toContain('%3F');
  });

  it('понимает обратные косые и диск', () => {
    const src = imageSrc('C:\\каталог\\файл #1.png');

    expect(src).toContain('file:///C:/');
    expect(src).not.toContain('\\');
    expect(src).toContain('%23');
  });
});

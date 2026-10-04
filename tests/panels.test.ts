// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '../src/core/types';
import { panelElement } from '../src/renderer/shared/panels';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function clickCopy(card: HTMLElement): void {
  const button = card.querySelector<HTMLButtonElement>('.card-copy');
  if (button === null) {
    throw new Error('Кнопка копирования не найдена');
  }
  button.click();
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
});

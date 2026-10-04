// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '../src/core/types';
import { installLinkGuard } from '../src/renderer/shared/links';
import { panelElement } from '../src/renderer/shared/panels';

let openExternal: ReturnType<typeof vi.fn>;

function install(): void {
  openExternal = vi.fn(async () => undefined);
  (window as unknown as { tishka: unknown }).tishka = { openExternal };
}

afterEach(() => {
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
  vi.restoreAllMocks();
});

function click(node: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
}

describe('installLinkGuard', () => {
  it('щелчок по ссылке в карточке открывает браузер и не пускает переход', () => {
    install();
    const url = 'https://mail.example.org/owa?path=/mail/action/compose&body=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82';
    const panel: Panel = { kind: 'list', title: 'Черновик', items: [{ title: 'Открыть', url }] };
    const host = document.createElement('div');
    host.append(panelElement(panel));
    document.body.append(host);
    installLinkGuard(document);

    const link = host.querySelector('.item-link') as HTMLAnchorElement;
    const event = click(link);

    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it('ссылки других схем и элементы без адреса не перехватываются', () => {
    install();
    const host = document.createElement('div');
    host.innerHTML = '<a href="file:///c:/secret.txt">файл</a><button>кнопка</button>';
    document.body.append(host);
    installLinkGuard(document);

    const event = click(host.querySelector('a') as HTMLAnchorElement);

    expect(event.defaultPrevented).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('адрес берётся как есть, без перекодирования', () => {
    install();
    const raw = 'https://example.org/?q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82&x=1';
    const host = document.createElement('div');
    const anchor = document.createElement('a');
    anchor.href = raw;
    anchor.dataset['url'] = raw;
    host.append(anchor);
    document.body.append(host);
    installLinkGuard(document);

    click(anchor);

    expect(openExternal).toHaveBeenCalledWith(raw);
  });
});

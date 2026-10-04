import type { PetModel } from '../../pet/state';
import { askCardElement } from '../shared/ask-card';
import { panelElement } from '../shared/panels';

export interface PetCardHost {
  element: HTMLElement;
  refreshBusy(): void;
}

export interface PetCard {
  render(model: PetModel): void;
}

// Карточка окна-питомца: одновременно показывается либо результат, либо ввод.
export function createPetCard(host: PetCardHost): PetCard {
  let lastKey = '';
  let closed = false;

  function close(): void {
    closed = true;
    host.element.hidden = true;
    host.refreshBusy();
  }

  function render(model: PetModel): void {
    const { panel, ask } = model;
    const key = JSON.stringify({ panel, ask, replies: model.replies ?? 0 });
    if (key !== lastKey) {
      lastKey = key;
      closed = false;
      host.element.replaceChildren();
      if (ask !== undefined) {
        host.element.append(
          askCardElement(ask, {
            onSend: (text) => {
              window.tishka.sendUserText(text);
            },
            onCancel: close
          })
        );
        window.tishka.pet.focus();
      } else if (panel !== undefined) {
        host.element.append(
          panelElement(panel, {
            onCopy: (text) => {
              void window.tishka.copyText(text);
            },
            onCopyRich: (html, text) => {
              void window.tishka.copyRich(html, text);
            },
            onOpenChat: () => {
              void window.tishka.openChat();
            },
            onClose: close
          })
        );
      }
    }
    host.element.hidden = (panel === undefined && ask === undefined) || closed;
  }

  return { render };
}

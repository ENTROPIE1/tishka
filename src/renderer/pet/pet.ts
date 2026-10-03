import type { Panel } from '../../core/types';
import type { PetModel, PetState } from '../../pet/state';
import { panelElement } from '../shared/panels';

const bubble = document.getElementById('bubble') as HTMLElement;
const say = document.getElementById('say') as HTMLElement;
const composer = document.getElementById('composer') as HTMLFormElement;
const input = document.getElementById('input') as HTMLInputElement;
const cardHost = document.getElementById('card-host') as HTMLElement;
const character = document.getElementById('character') as HTMLElement;
const stateLabel = document.getElementById('state') as HTMLElement;

const STATE_LABELS: Record<PetState, string> = {
  hidden: 'спит за краем',
  appear: 'выходит',
  idle: 'ждёт',
  listening: 'слушает',
  thinking: 'думает',
  working: 'работает',
  talking: 'говорит',
  notify: 'замечает',
  happy: 'радуется',
  confused: 'не понял',
  leave: 'уходит',
  sleep: 'спит'
};

let lastPanelKey = '';
let lastSay = '';
let cardClosed = false;
let interactive = false;
let dragging = false;
let dragMoved = false;
let dragLastX = 0;

function isOnScreen(state: PetState): boolean {
  return state !== 'hidden' && state !== 'leave';
}

function refreshBusy(): void {
  const cardOpen = !cardHost.hidden;
  const typing = !composer.hidden && input.value !== '';
  window.tishka.pet.setBusy(cardOpen || typing);
}

function updateBubble(): void {
  const text = say.textContent ?? '';
  bubble.hidden = text === '' && composer.hidden;
}

function renderCard(panel: Panel | undefined): void {
  const key = panel === undefined ? '' : JSON.stringify(panel);
  if (key !== lastPanelKey) {
    lastPanelKey = key;
    cardClosed = false;
    cardHost.replaceChildren();
    if (panel !== undefined) {
      cardHost.append(
        panelElement(panel, {
          onCopy: (text) => {
            void window.tishka.copyText(text);
          },
          onOpenChat: () => {
            void window.tishka.openChat();
          },
          onClose: () => {
            cardClosed = true;
            cardHost.hidden = true;
            refreshBusy();
          }
        })
      );
    }
  }
  cardHost.hidden = panel === undefined || cardClosed;
}

function renderModel(model: PetModel): void {
  stateLabel.textContent = STATE_LABELS[model.state];
  say.textContent = model.say ?? '';
  renderCard(model.panel);

  // Поле ввода живёт, пока Тишка на экране после вызова; появляется вместе с выходом.
  if (!isOnScreen(model.state)) {
    composer.hidden = true;
  } else if (model.state === 'appear' || model.state === 'listening') {
    const wasHidden = composer.hidden;
    composer.hidden = false;
    if (wasHidden) {
      input.focus();
    }
  }

  updateBubble();
  refreshBusy();

  const sayText = model.say ?? '';
  if (sayText !== lastSay && sayText !== '' && !composer.hidden) {
    input.focus();
  }
  lastSay = sayText;
}

function isInteractiveAt(x: number, y: number): boolean {
  const element = document.elementFromPoint(x, y);
  if (element === null) {
    return false;
  }
  return character.contains(element) || bubble.contains(element) || cardHost.contains(element);
}

function setInteractive(value: boolean): void {
  if (value === interactive) {
    return;
  }
  interactive = value;
  window.tishka.pet.setInteractive(value);
}

function openComposer(): void {
  window.tishka.pet.wake('click');
  composer.hidden = false;
  input.value = '';
  updateBubble();
  refreshBusy();
  input.focus();
}

function closeComposer(): void {
  composer.hidden = true;
  updateBubble();
  refreshBusy();
}

function initCharacter(): void {
  character.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    dragMoved = false;
    dragLastX = event.screenX;
    setInteractive(true);
    event.preventDefault();
  });
}

function initComposer(): void {
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text === '') {
      return;
    }
    window.tishka.sendUserText(text);
    input.value = '';
    updateBubble();
    refreshBusy();
  });
  input.addEventListener('input', refreshBusy);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeComposer();
    }
  });
}

function initPointer(): void {
  window.addEventListener('mousemove', (event) => {
    if (dragging) {
      const delta = event.screenX - dragLastX;
      if (Math.abs(delta) > 3) {
        dragMoved = true;
      }
      dragLastX = event.screenX;
      if (delta !== 0) {
        window.tishka.pet.dragBy(delta);
      }
      return;
    }
    setInteractive(isInteractiveAt(event.clientX, event.clientY));
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    window.tishka.pet.dragEnd();
    if (!dragMoved) {
      openComposer();
    }
  });
}

window.tishka.onPetModel(renderModel);
window.tishka.pet.setInteractive(false);
initCharacter();
initComposer();
initPointer();

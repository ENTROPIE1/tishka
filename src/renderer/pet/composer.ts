import { screenLookAction, type ScreenLookAction } from '../shared/screen-look-request';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const PLACEHOLDER_IDLE = 'Написать Тишке…';
export const PLACEHOLDER_LISTENING = 'Говорите или пишите…';
export const PLACEHOLDER_WAITING = 'Готовлю микрофон…';

const MIC_PATHS = [
  'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z',
  'M5 11a7 7 0 0 0 14 0',
  'M12 18v3'
];
const SEND_PATHS = ['M4 12h13', 'M11 6l6 6-6 6'];
// Тот же глаз, что в кнопке чата: вид переключателя просмотра экрана.
const EYE_PATHS = [
  'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z',
  'M14.6 12a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0z'
];
const GEAR_PATHS = [
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
  'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
];

export interface ComposerActions {
  onSend(text: string): void;
  onEscape(): void;
  onExpand(): void;
  onFocus(): void;
  onSettings?(): void;
  onScreenLook?(action: ScreenLookAction): void;
}

export interface Composer {
  element: HTMLFormElement;
  input: HTMLInputElement;
  mic: HTMLButtonElement;
  eye: HTMLButtonElement;
  settings: HTMLButtonElement;
  setListening(listening: boolean): void;
  setWaiting(waiting: boolean): void;
  setBusy(busy: boolean): void;
  setCollapsed(collapsed: boolean): void;
  setLooking(looking: boolean): void;
  setScreenLookAvailable(available: boolean): void;
  isCollapsed(): boolean;
  focus(): void;
  clear(): void;
}

function svgIcon(className: string, paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// Строка общения под ёжиком: микрофон, глаз, поле «Написать Тишке…» и отправка.
// Отправка во время работы Тишки встаёт в очередь и уходит после ответа.
// Глаз — переключатель просмотра экрана, как кнопка с глазом в чате.
export function createComposer(actions: ComposerActions): Composer {
  const element = document.createElement('form');
  element.id = 'composer';
  element.className = 'composer';
  element.noValidate = true;

  const mic = document.createElement('button');
  mic.id = 'mic';
  mic.className = 'mic';
  mic.type = 'button';
  mic.title = 'Сказать голосом';
  mic.setAttribute('aria-label', 'Сказать голосом');
  mic.append(svgIcon('mic-icon', MIC_PATHS));

  const eye = document.createElement('button');
  eye.id = 'screen-look';
  eye.className = 'mic';
  eye.type = 'button';
  eye.title = 'Посмотреть на экран';
  eye.setAttribute('aria-label', 'Посмотреть на экран');
  eye.append(svgIcon('mic-icon', EYE_PATHS));
  // Появляется только после того, как настройки разрешат просмотр экрана.
  eye.hidden = true;
  eye.addEventListener('click', () => {
    lookAtScreen();
  });

  const input = document.createElement('input');
  input.id = 'input';
  input.className = 'composer-input';
  input.type = 'text';
  input.placeholder = PLACEHOLDER_IDLE;
  input.autocomplete = 'off';

  const send = document.createElement('button');
  send.id = 'send';
  send.className = 'composer-send';
  send.type = 'submit';
  send.title = 'Отправить';
  send.setAttribute('aria-label', 'Отправить');
  send.append(svgIcon('send-icon', SEND_PATHS));

  const settings = document.createElement('button');
  settings.id = 'settings';
  settings.className = 'mic';
  settings.type = 'button';
  settings.title = 'Настройки';
  settings.setAttribute('aria-label', 'Настройки');
  settings.append(svgIcon('mic-icon', GEAR_PATHS));
  settings.addEventListener('click', () => {
    actions.onSettings?.();
  });

  const level = document.createElement('div');
  level.id = 'level';
  level.className = 'level';
  level.hidden = true;
  const levelFill = document.createElement('div');
  levelFill.id = 'level-fill';
  levelFill.className = 'level-fill';
  level.append(levelFill);

  element.append(mic, eye, input, send, settings, level);

  let busy = false;
  let collapsed = false;
  let listening = false;
  let waiting = false;
  let looking = false;
  let screenLookAvailable = false;
  const queue: string[] = [];

  // Подсказка в поле: пока микрофон не готов, честно ждём; затем — говорите или пишите.
  function applyPlaceholder(): void {
    input.placeholder = waiting ? PLACEHOLDER_WAITING : listening ? PLACEHOLDER_LISTENING : PLACEHOLDER_IDLE;
  }

  // Вид кнопки с глазом ведут события ядра о просмотре экрана, не нажатия.
  function applyLook(): void {
    eye.classList.toggle('on', looking);
    eye.hidden = !screenLookAvailable;
  }

  function lookAtScreen(): void {
    const action = screenLookAction({
      looking,
      busy,
      available: screenLookAvailable,
      question: input.value.trim()
    });
    if (action.kind === 'none') {
      return;
    }
    if (action.kind === 'send') {
      input.value = '';
    }
    actions.onScreenLook?.(action);
  }

  function setCollapsed(value: boolean): void {
    collapsed = value;
    element.classList.toggle('collapsed', value);
  }

  function sendText(): void {
    const text = input.value.trim();
    if (text === '') {
      return;
    }
    input.value = '';
    if (busy) {
      queue.push(text);
      return;
    }
    actions.onSend(text);
  }

  function setBusy(value: boolean): void {
    busy = value;
    if (value || queue.length === 0) {
      return;
    }
    const pending = queue.splice(0, queue.length);
    for (const text of pending) {
      actions.onSend(text);
    }
  }

  element.addEventListener('submit', (event) => {
    event.preventDefault();
    sendText();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendText();
      return;
    }
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    if (input.value !== '') {
      input.value = '';
      return;
    }
    actions.onEscape();
  });

  element.addEventListener('click', () => {
    if (collapsed) {
      setCollapsed(false);
      actions.onExpand();
    }
  });

  // Окно может быть без фокуса даже когда строка видна: любой щелчок по строке
  // возвращает фокус окну, чтобы набранный текст не терялся.
  element.addEventListener('pointerdown', () => {
    actions.onFocus();
  });

  return {
    element,
    input,
    mic,
    eye,
    settings,
    setListening(value): void {
      listening = value;
      applyPlaceholder();
    },
    setWaiting(value): void {
      waiting = value;
      applyPlaceholder();
    },
    setBusy,
    setCollapsed,
    setLooking(value): void {
      if (looking === value) {
        return;
      }
      looking = value;
      applyLook();
    },
    setScreenLookAvailable(value): void {
      if (screenLookAvailable === value) {
        return;
      }
      screenLookAvailable = value;
      applyLook();
    },
    isCollapsed: () => collapsed,
    focus(): void {
      input.focus();
    },
    clear(): void {
      input.value = '';
    }
  };
}

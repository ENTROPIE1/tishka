// Композер чата: отправка реплик, кнопка «посмотреть на экран» и остановка.
// Пока Тишка занят, повторная отправка блокируется, а «Отправить» превращается в «Стоп».

export interface ComposerElements {
  send: HTMLButtonElement;
  screenLook: HTMLButtonElement;
  input: HTMLTextAreaElement;
}

export interface ComposerDeps {
  send(text: string): void;
  stop(): void;
  echo(text: string): void;      // реплика человека появляется в ленте сразу
  status(text: string): void;
}

export interface ChatComposer {
  sendMessage(): void;
  lookAtScreen(): void;
  onSendClick(): void;
  escape(): boolean;             // true — нажатие обработано как остановка
  begin(): void;
  end(): void;
  isBusy(): boolean;
}

const SEND_LABEL = 'Отправить';
const STOP_LABEL = 'Стоп';
const LOOK_DEFAULT = 'Посмотри, что у меня на экране';
const LOOK_STATUS = 'Смотрю на экран…';

function lookText(question: string): string {
  return question === '' ? LOOK_DEFAULT : `Посмотри на экран. ${question}`;
}

export function createComposer(elements: ComposerElements, deps: ComposerDeps): ChatComposer {
  let busy = false;

  function apply(): void {
    elements.send.textContent = busy ? STOP_LABEL : SEND_LABEL;
    elements.send.classList.toggle('stop', busy);
    elements.screenLook.disabled = busy;
    elements.screenLook.classList.toggle('busy', busy);
  }

  // Одинаковое действие второй раз в очередь не ставится: пока Тишка занят,
  // кнопки блокируются, а реплика человека уже показана в ленте.
  function submit(text: string, statusText?: string): boolean {
    if (busy || text === '') {
      return false;
    }
    busy = true;
    apply();
    deps.echo(text);
    if (statusText !== undefined) {
      deps.status(statusText);
    }
    deps.send(text);
    return true;
  }

  function sendMessage(): void {
    if (submit(elements.input.value.trim())) {
      elements.input.value = '';
      elements.input.focus();
    }
  }

  function lookAtScreen(): void {
    const question = elements.input.value.trim();
    if (submit(lookText(question), LOOK_STATUS)) {
      elements.input.value = '';
      elements.input.focus();
    }
  }

  function requestStop(): void {
    if (busy) {
      deps.stop();
    }
  }

  return {
    sendMessage,
    lookAtScreen,
    onSendClick(): void {
      if (busy) {
        requestStop();
        return;
      }
      sendMessage();
    },
    escape(): boolean {
      if (!busy) {
        return false;
      }
      requestStop();
      return true;
    },
    begin(): void {
      if (!busy) {
        busy = true;
        apply();
      }
    },
    end(): void {
      if (busy) {
        busy = false;
        apply();
      }
    },
    isBusy: () => busy
  };
}

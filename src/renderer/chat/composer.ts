// Композер чата: отправка реплик, кнопка с глазом — переключатель просмотра
// экрана и остановка. Пока Тишка занят, повторная отправка блокируется,
// а «Отправить» превращается в «Стоп».

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
  setLooking(looking: boolean): void;
  setAvailable(available: boolean): void;
  isBusy(): boolean;
  isLooking(): boolean;
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
  let looking = false;
  let available = true;   // просмотр экрана разрешён в настройках

  function apply(): void {
    elements.send.textContent = busy ? STOP_LABEL : SEND_LABEL;
    elements.send.classList.toggle('stop', busy);
    // В активном виде кнопка с глазом останавливает, поэтому не гаснет.
    elements.screenLook.disabled = busy && !looking;
    elements.screenLook.classList.toggle('active', looking);
    elements.screenLook.hidden = !available;
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
    // Активный вид: Тишка смотрит на экран, нажатие останавливает просмотр
    // через существующий канал остановки.
    if (looking) {
      deps.stop();
      return;
    }
    // Занят другой работой или просмотр запрещён: запускать нечего.
    if (busy || !available) {
      return;
    }
    const question = elements.input.value.trim();
    if (submit(lookText(question), LOOK_STATUS)) {
      looking = true;
      apply();
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
    setLooking(value: boolean): void {
      if (looking !== value) {
        looking = value;
        apply();
      }
    },
    setAvailable(value: boolean): void {
      if (available !== value) {
        available = value;
        apply();
      }
    },
    isBusy: () => busy,
    isLooking: () => looking
  };
}

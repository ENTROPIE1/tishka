import { createChatFeed } from './feed';
import { initAppShell } from './navigation';
import { createTalkMode, type TalkMode } from './talk-mode';
import { mountChatToolbar } from './toolbar';

const feed = document.getElementById('feed') as HTMLElement;
const statusLine = document.getElementById('status') as HTMLElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendButton = document.getElementById('send') as HTMLButtonElement;
const clearButton = document.getElementById('clear-history') as HTMLButtonElement;
const settingsButton = document.getElementById('open-settings') as HTMLButtonElement;
const bannerButton = document.getElementById('open-settings-banner') as HTMLButtonElement;
const noKeyBanner = document.getElementById('no-key') as HTMLElement;
const micSlot = document.getElementById('mic-slot') as HTMLElement;
const screenLookButton = document.getElementById('screen-look') as HTMLButtonElement;
const dictation = document.getElementById('dictation') as HTMLElement;
const dictationLevel = document.getElementById('dictation-level') as HTMLElement;
const dictationLabel = dictation.querySelector('.dictation-label') as HTMLElement;
const keyDot = document.getElementById('key-dot') as HTMLElement;

const view = createChatFeed(feed);
let talkMode: TalkMode | undefined;

function nowIso(): string {
  return new Date().toISOString();
}

function setStatus(text: string): void {
  statusLine.textContent = text;
  statusLine.hidden = false;
}

function clearStatus(): void {
  statusLine.hidden = true;
  statusLine.textContent = '';
}

function send(): void {
  const text = input.value.trim();
  if (text === '') {
    return;
  }
  window.tishka.sendUserText(text);
  input.value = '';
  input.focus();
  talkMode?.keyboard();
}

function initEvents(): void {
  window.tishka.onEvent((event) => {
    switch (event.type) {
      case 'listen.end':
        // Перечитываем историю: ядро могло начать новый разговор и добавить разделитель.
        void reloadFeed();
        break;
      case 'reply':
        view.appendEntry({
          kind: 'message',
          id: crypto.randomUUID(),
          at: nowIso(),
          from: 'tishka',
          text: event.reply.say,
          panel: event.reply.show,
          mood: event.reply.mood
        });
        if (event.reply.ask !== undefined) {
          view.appendAskCard(event.reply.ask);
        }
        clearStatus();
        break;
      case 'notify':
        view.appendEntry({ kind: 'message', id: crypto.randomUUID(), at: nowIso(), from: 'system', text: event.title });
        break;
      case 'skill.saved':
        view.appendSkillCard(event.skillId);
        break;
      case 'error':
        view.appendEntry({ kind: 'message', id: crypto.randomUUID(), at: nowIso(), from: 'system', text: event.message });
        clearStatus();
        break;
      case 'think.start':
        setStatus('Тишка думает…');
        break;
      case 'tool.start':
        setStatus(`Тишка использует инструмент ${event.tool}`);
        break;
      case 'idle':
        clearStatus();
        break;
      default:
        break;
    }
  });
}

function initFeed(): void {
  feed.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) {
      return;
    }
    const url = target.dataset['url'];
    if (url === undefined || url === '') {
      return;
    }
    event.preventDefault();
    void window.tishka.openExternal(url);
  });
}

function initComposer(): void {
  sendButton.addEventListener('click', send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
}

// Кнопка микрофона — переключатель режима разговора, как в окне-питомце.
function initTalkMode(): void {
  talkMode = createTalkMode(
    { level: dictation, levelFill: dictationLevel, label: dictationLabel },
    (message) => setStatus(message)
  );
  micSlot.append(talkMode.button);
}

// Кнопка с глазом отправляет набранный вопрос вместе с просьбой посмотреть на экран.
function initScreenLookButton(): void {
  screenLookButton.addEventListener('click', () => {
    const question = input.value.trim();
    const text = question === '' ? 'Посмотри, что у меня на экране' : `Посмотри на экран. ${question}`;
    window.tishka.sendUserText(text);
    input.value = '';
    input.focus();
  });
}

function initClearButton(): void {
  clearButton.addEventListener('click', () => {
    if (!window.confirm('Очистить всю переписку с Тишкой?')) {
      return;
    }
    void window.tishka.clearHistory().then(() => {
      view.clear();
      clearStatus();
    });
  });
}

async function loadHistory(): Promise<void> {
  view.fill(await window.tishka.history(200));
}

async function reloadFeed(): Promise<void> {
  view.refill(await window.tishka.history(200));
}

function initSettingsButtons(): void {
  const open = (): void => {
    void window.tishka.openSettings();
  };
  settingsButton.addEventListener('click', open);
  bannerButton.addEventListener('click', open);
}

async function refreshKeyState(): Promise<void> {
  try {
    const view = await window.tishka.config.get();
    noKeyBanner.hidden = view.gatewayKeySet;
    keyDot.classList.toggle('set', view.gatewayKeySet);
  } catch {
    noKeyBanner.hidden = true;
    keyDot.classList.remove('set');
  }
}

window.addEventListener('focus', () => {
  void refreshKeyState();
});

window.tishka.config.onChanged(() => {
  void refreshKeyState();
});

initAppShell();
initEvents();
initFeed();
initComposer();
initTalkMode();
initScreenLookButton();
initClearButton();
mountChatToolbar({ feed: view, reload: reloadFeed, loadAll: () => window.tishka.history(2000) });
initSettingsButtons();
void loadHistory();
void refreshKeyState();

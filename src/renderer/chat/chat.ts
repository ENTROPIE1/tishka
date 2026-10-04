import { installLinkGuard } from '../shared/links';
import { timingMark } from '../shared/timing';
import { SCREEN_LOOK_TOOLS } from '../../core/screen-look';
import { STOPPED_TITLE } from '../../core/stopped';
import { createChatFeed } from './feed';
import { createComposer } from './composer';
import { initAppShell } from './navigation';
import { appendSkillSaveCard } from './skill-card';
import { createTalkMode, type TalkMode } from './talk-mode';
import { mountChatToolbar } from './toolbar';

const feed = document.getElementById('feed') as HTMLElement;
const statusLine = document.getElementById('status') as HTMLElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendButton = document.getElementById('send') as HTMLButtonElement;
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

// Реплика человека показывается в ленте сразу при отправке, а не когда
// до неё дошла очередь; после перечитывания истории её заменит запись из истории.
function echoUserMessage(text: string): void {
  view.appendEntry({
    kind: 'message',
    id: crypto.randomUUID(),
    at: nowIso(),
    from: 'user',
    text
  });
}

const composer = createComposer(
  { send: sendButton, screenLook: screenLookButton, input },
  {
    send: (text) => window.tishka.sendUserText(text),
    stop: () => window.tishka.stop(),
    echo: echoUserMessage,
    status: setStatus
  }
);

function send(): void {
  composer.sendMessage();
  talkMode?.keyboard();
}

function initEvents(): void {
  window.tishka.onEvent((event) => {
    switch (event.type) {
      case 'listen.end':
        // Перечитываем историю: ядро могло начать новый разговор и добавить разделитель.
        void reloadFeed();
        composer.begin();
        break;
      case 'reply':
        timingMark('reply.shown');
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
      case 'status':
        // Служебная строка остановки из окна чата живёт только в ленте:
        // ежа она не поднимает, в историю не пишется.
        if (event.text === STOPPED_TITLE) {
          view.appendEntry({ kind: 'message', id: crypto.randomUUID(), at: nowIso(), from: 'system', text: event.text });
        }
        break;
      case 'skill.saved':
        appendSkillSaveCard(view, event);
        break;
      case 'error':
        view.appendEntry({ kind: 'message', id: crypto.randomUUID(), at: nowIso(), from: 'system', text: event.message });
        clearStatus();
        break;
      case 'think.start':
        composer.begin();
        setStatus('Тишка думает…');
        break;
      case 'tool.start':
        composer.begin();
        // Начало просмотра экрана: кнопка с глазом в активном виде.
        if (SCREEN_LOOK_TOOLS.has(event.tool)) {
          composer.setLooking(true);
        }
        setStatus(`Тишка использует инструмент ${event.tool}`);
        break;
      case 'tool.end':
        // Конец просмотра экрана: вид всегда от события ядра, не от кнопки.
        if (SCREEN_LOOK_TOOLS.has(event.tool)) {
          composer.setLooking(false);
        }
        break;
      case 'idle':
        composer.end();
        composer.setLooking(false);
        clearStatus();
        break;
      default:
        break;
    }
  });
}

function initFeed(): void {
  installLinkGuard(document);
}

function initComposer(): void {
  sendButton.addEventListener('click', () => composer.onSendClick());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    // Пока Тишка занят, Escape останавливает текущую работу.
    if (event.key === 'Escape' && composer.escape()) {
      return;
    }
    talkMode?.keyboard();
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
  screenLookButton.addEventListener('click', () => composer.lookAtScreen());
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
    // Просмотр экрана выключен в настройках: кнопка с глазом скрыта.
    composer.setAvailable(view.config.screen.enabled);
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
mountChatToolbar({
  feed: view,
  reload: reloadFeed,
  loadAll: () => window.tishka.history(2000),
  setStatus,
  clearStatus
});
initSettingsButtons();
void loadHistory();
void refreshKeyState();

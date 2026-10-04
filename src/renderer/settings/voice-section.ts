import type { Config } from '../../core/types';
import type { VoiceStateView } from '../../main/ipc-settings';
import { button, clear, el, field, runWithFeedback, sectionTitle, textInput } from './dom';

const STATE_LABELS: Record<VoiceStateView['state'], string> = {
  off: 'не настроена',
  starting: 'запускается…',
  ready: 'готова',
  error: 'ошибка'
};

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };
const CHECK_LABELS = { busy: 'Проверяю…', done: 'Готово', error: 'Ошибка' };
const POLL_MS = 1000;

export function mountVoiceSection(root: HTMLElement): void {
  clear(root);
  root.append(sectionTitle('Голос'));

  const hotkey = textInput();
  const exe = textInput();
  const model = textInput();
  const wakeEnabled = el('input', 'checkbox-input');
  wakeEnabled.type = 'checkbox';
  const wakeWords = textInput();
  const talkTimeout = textInput('', 'number');
  const state = el('span', 'state state-off', STATE_LABELS.off);
  const save = button('Сохранить');
  const check = button('Проверить', 'button button-secondary');
  const messages = el('div', 'messages');

  root.append(
    field('Горячая клавиша', hotkey, 'Например, Control+Alt+Space'),
    field(
      'Откликаться на имя',
      wakeEnabled,
      'Микрофон слушается постоянно, речь распознаётся на этом компьютере и никуда не передаётся; фразы без имени сразу отбрасываются'
    ),
    field('Имена', wakeWords, 'Через запятую, например: тишка, ёжик'),
    field('Уходить после тишины, секунд', talkTimeout),
    field('Программа распознавания', exe, 'Путь к whisper-server без кириллицы; пусто — служба не запускается'),
    field('Модель распознавания', model),
    field('Состояние службы', state)
  );
  const actions = el('div', 'row');
  actions.append(save, check);
  root.append(actions, messages);

  function show(error?: string): void {
    clear(messages);
    if (error !== undefined) {
      messages.append(el('div', 'message-error', error));
    }
  }

  function renderState(view: VoiceStateView): void {
    state.className = `state state-${view.state}`;
    state.textContent = STATE_LABELS[view.state];
    check.disabled = view.state === 'starting';
    if (view.error !== undefined) {
      show(view.error);
    } else {
      clear(messages);
    }
  }

  let watchTimer: number | undefined;
  let watchLeft = 0;

  // Пока служба запускается, метка обновляется сама. Короткая серия проверок
  // ловит переход в запуск сразу после сохранения настроек.
  async function watchStatus(): Promise<void> {
    if (watchTimer !== undefined) {
      return;
    }
    try {
      const view = await window.tishka.voice.status();
      renderState(view);
      const idle = view.state === 'off' && watchLeft > 0;
      if (view.state === 'starting' || idle) {
        if (idle) {
          watchLeft -= 1;
        }
        watchTimer = window.setTimeout(() => {
          watchTimer = undefined;
          void watchStatus();
        }, POLL_MS);
      }
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    hotkey.value = view.config.voice.hotkey;
    wakeEnabled.checked = view.config.voice.wakeEnabled;
    wakeWords.value = view.config.voice.wakeWords.join(', ');
    talkTimeout.value = String(view.config.voice.talkTimeoutSec);
    exe.value = view.config.voice.stt.exe;
    model.value = view.config.voice.stt.model;
    await watchStatus();
  }

  function parseWords(value: string, fallback: string[]): string[] {
    const words = value
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word !== '');
    return words.length > 0 ? words : fallback;
  }

  function parseTimeout(value: string, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
  }

  save.addEventListener('click', () => {
    void runWithFeedback(save, SAVE_LABELS, async () => {
      try {
        const view = await window.tishka.config.get();
        const next: Config = {
          ...view.config,
          voice: {
            ...view.config.voice,
            hotkey: hotkey.value.trim(),
            wakeEnabled: wakeEnabled.checked,
            wakeWords: parseWords(wakeWords.value, view.config.voice.wakeWords),
            talkTimeoutSec: parseTimeout(talkTimeout.value, view.config.voice.talkTimeoutSec),
            stt: {
              ...view.config.voice.stt,
              exe: exe.value.trim(),
              model: model.value.trim()
            }
          }
        };
        await window.tishka.config.save(next);
        await window.tishka.voice.apply(next.voice.hotkey);
        show();
        messages.append(el('div', 'message-ok', 'Настройки голоса сохранены'));
        watchLeft = 10;
        void watchStatus();
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });

  check.addEventListener('click', () => {
    void runWithFeedback(check, CHECK_LABELS, async () => {
      try {
        renderState(await window.tishka.voice.check());
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });

  void refresh();
}

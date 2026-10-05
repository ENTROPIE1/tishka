import type { VoiceStateView } from '../../main/ipc-settings';
import type { Config } from '../../core/types';
import type { SttDetector } from '../../voice/stt-service';
import {
  button,
  checkboxField,
  clear,
  el,
  field,
  runWithFeedback,
  sectionTitle,
  selectInput,
  textInput,
  type SettingsSection
} from './dom';
import { createMicrophoneGroup } from './microphone-group';
import { saveVoice } from './voice-save';

const STATE_LABELS: Record<VoiceStateView['state'], string> = {
  off: 'не настроена',
  starting: 'запускается…',
  ready: 'готова',
  error: 'ошибка'
};

const DETECTOR_LABELS: Record<SttDetector, string> = {
  on: 'включён',
  'no-model': 'файл модели не найден',
  off: 'выключен'
};

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };
const CHECK_LABELS = { busy: 'Перезапускаю…', done: 'Готово', error: 'Ошибка' };
const CHECK_URL_LABELS = { busy: 'Проверяю…', done: 'Готово', error: 'Ошибка' };
const MODE_OPTIONS = [
  { value: 'local', label: 'Запускать на этом компьютере' },
  { value: 'remote', label: 'Готовая служба по адресу' }
];
const POLL_MS = 1000;

function group(title: string, ...children: HTMLElement[]): HTMLElement {
  const box = el('div', 'voice-group');
  box.append(el('h3', 'group-title', title), ...children);
  return box;
}

export function mountVoiceSection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Голос'));

  const hotkey = textInput();
  const wakeEnabled = el('input', 'checkbox-input');
  wakeEnabled.type = 'checkbox';
  const talkByDefault = el('input', 'checkbox-input');
  talkByDefault.type = 'checkbox';
  const wakeWords = textInput();
  const talkTimeout = textInput('', 'number');
  const mode = selectInput(MODE_OPTIONS, 'local');
  mode.classList.add('stt-mode');
  const exe = textInput();
  const model = textInput();
  const sttUrl = textInput();
  const state = el('span', 'state state-off', STATE_LABELS.off);
  const detector = el('span', 'state detector-state', DETECTOR_LABELS.off);
  const check = button('Перезапустить службу', 'button button-secondary');
  const checkUrl = button('Проверить', 'button button-secondary');
  const save = button('Сохранить');
  const messages = el('div', 'messages');

  let mic: Config['voice']['mic'] = { threshold: null, noise: null, speech: null, calibratedAt: null };
  const micGroup = createMicrophoneGroup({
    getMic: () => mic,
    saveMic: async (next) => {
      const view = await window.tishka.config.get();
      await window.tishka.config.save({ ...view.config, voice: { ...view.config.voice, mic: next } });
      mic = next;
    },
    dictate: (wav) => window.tishka.voice.dictate(wav),
    pause: (active) => {
      void window.tishka.voice.calibration(active);
    },
    showError: (message) => show(message),
    onChanged: () => void refresh()
  });
  const localFields = el('div', 'voice-group-fields local-fields');
  localFields.append(
    field('Программа распознавания', exe, 'Путь к whisper-server без кириллицы; пусто — служба не запускается'),
    field('Модель распознавания', model)
  );
  const remoteFields = el('div', 'voice-group-fields remote-fields');
  remoteFields.append(field('Адрес службы', sttUrl, 'Например, http://127.0.0.1:8178'));
  const remoteActions = el('div', 'row');
  remoteActions.append(checkUrl);
  remoteFields.append(remoteActions);

  const service = group(
    'Служба распознавания',
    field('Где запускать', mode),
    localFields,
    remoteFields,
    field('Состояние службы', state),
    field('Детектор речи службы', detector)
  );
  const serviceActions = el('div', 'row');
  serviceActions.append(check);
  service.append(serviceActions);

  const actions = el('div', 'row');
  actions.append(save);

  root.append(
    group(
      'Как звать Тишку',
      field('Горячая клавиша', hotkey, 'Например, Control+Alt+Space'),
      checkboxField(
        'Откликаться на имя',
        wakeEnabled,
        'Микрофон слушается постоянно, речь распознаётся на этом компьютере и никуда не передаётся; фразы без имени сразу отбрасываются'
      ),
      checkboxField(
        'Слушать сразу, как Тишка появился',
        talkByDefault,
        'После обращения по имени, клавише или щелчку микрофон остаётся включённым, пока Тишка не уйдёт'
      ),
      field('Имена', wakeWords, 'Через запятую, например: тишка, ёжик'),
      field('Уходить после тишины, секунд', talkTimeout)
    ),
    micGroup.element,
    service,
    actions,
    messages
  );

  function isRemote(): boolean {
    return mode.value === 'remote';
  }

  // Поля местной службы и адреса готовой показываются по очереди: выбранный
  // вариант определяет, что используется, но значения другого не стираются.
  function applyMode(): void {
    const remote = isRemote();
    localFields.hidden = remote;
    remoteFields.hidden = !remote;
    check.hidden = remote;
  }

  mode.addEventListener('change', applyMode);

  function show(error?: string, ok?: string): void {
    clear(messages);
    if (error !== undefined) {
      messages.append(el('div', 'message-error', error));
    }
    if (ok !== undefined) {
      messages.append(el('div', 'message-ok', ok));
    }
  }

  function renderState(view: VoiceStateView): void {
    state.className = `state state-${view.state}`;
    state.textContent = STATE_LABELS[view.state];
    detector.textContent = DETECTOR_LABELS[view.detector ?? 'off'];
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
    talkByDefault.checked = view.config.voice.talkByDefault;
    wakeWords.value = view.config.voice.wakeWords.join(', ');
    talkTimeout.value = String(view.config.voice.talkTimeoutSec);
    mic = view.config.voice.mic;
    mode.value = view.config.voice.stt.mode;
    exe.value = view.config.voice.stt.exe;
    model.value = view.config.voice.stt.model;
    sttUrl.value = view.config.voice.sttUrl;
    applyMode();
    micGroup.refresh();
    await watchStatus();
  }

  save.addEventListener('click', () => {
    void runWithFeedback(save, SAVE_LABELS, async () => {
      try {
        await saveVoice({
          hotkey,
          wakeEnabled,
          talkByDefault,
          wakeWords,
          talkTimeout,
          mode,
          sttUrl,
          exe,
          model
        });
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

  checkUrl.addEventListener('click', () => {
    void runWithFeedback(checkUrl, CHECK_URL_LABELS, async () => {
      const result = await window.tishka.voice.checkUrl(sttUrl.value.trim());
      if (!result.ok) {
        const error = result.error ?? 'Служба не отвечает';
        show(error);
        throw new Error(error);
      }
      show(undefined, `Служба отвечает, ${result.ms} мс`);
    });
  });

  void refresh();

  return { refresh: () => void refresh() };
}

import type { Config } from '../../core/types';
import type { VoiceStateView } from '../../main/ipc-settings';
import { button, clear, el, field, sectionTitle, textInput } from './dom';

const STATE_LABELS: Record<VoiceStateView['state'], string> = {
  off: 'выключена',
  starting: 'запускается',
  ready: 'готова',
  error: 'ошибка'
};

export function mountVoiceSection(root: HTMLElement): void {
  clear(root);
  root.append(sectionTitle('Голос'));

  const hotkey = textInput();
  const exe = textInput();
  const model = textInput();
  const state = el('span', 'state', STATE_LABELS.off);
  const save = button('Сохранить');
  const check = button('Проверить', 'button button-secondary');
  const messages = el('div', 'messages');

  root.append(
    field('Горячая клавиша', hotkey, 'Например, Control+Alt+Space'),
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
    if (view.error !== undefined) {
      show(view.error);
    }
  }

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    hotkey.value = view.config.voice.hotkey;
    exe.value = view.config.voice.stt.exe;
    model.value = view.config.voice.stt.model;
    try {
      renderState(await window.tishka.voice.status());
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  save.addEventListener('click', () => {
    void (async () => {
      save.disabled = true;
      try {
        const view = await window.tishka.config.get();
        const next: Config = {
          ...view.config,
          voice: {
            ...view.config.voice,
            hotkey: hotkey.value.trim(),
            stt: {
              ...view.config.voice.stt,
              exe: exe.value.trim(),
              model: model.value.trim()
            }
          }
        };
        await window.tishka.config.save(next);
        await window.tishka.voice.apply(next.voice.hotkey);
        clear(messages);
        messages.append(el('div', 'message-ok', 'Настройки голоса сохранены'));
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
      } finally {
        save.disabled = false;
      }
    })();
  });

  check.addEventListener('click', () => {
    void (async () => {
      check.disabled = true;
      clear(messages);
      try {
        renderState(await window.tishka.voice.check());
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
      } finally {
        check.disabled = false;
      }
    })();
  });

  void refresh();
}

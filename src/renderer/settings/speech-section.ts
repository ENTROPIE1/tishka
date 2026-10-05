import type { Config } from '../../core/types';
import type { TtsHealth } from '../../voice/tts-client';
import { button, checkboxField, clear, el, field, runWithFeedback, sectionTitle, textInput, type SettingsSection } from './dom';

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };
const CHECK_LABELS = { busy: 'Проверяю…', done: 'Готово', error: 'Ошибка' };
const SAY_LABELS = { busy: 'Говорю…', done: 'Готово', error: 'Ошибка' };

export function mountSpeechSection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Речь вслух'));

  const enabled = el('input', 'checkbox-input');
  enabled.type = 'checkbox';
  const bySentence = el('input', 'checkbox-input');
  bySentence.type = 'checkbox';
  const url = textInput();
  const volume = textInput('', 'number');
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  const state = el('span', 'state state-off', 'не проверялась');
  const save = button('Сохранить');
  const check = button('Проверить', 'button button-secondary');
  const say = button('Сказать пример', 'button button-secondary');
  const messages = el('div', 'messages');

  root.append(
    checkboxField('Говорить вслух', enabled, 'Реплики Тишки произносит служба синтеза; текст карточек остаётся на экране'),
    checkboxField(
      'Начинать говорить, не дожидаясь всей реплики',
      bySentence,
      'Реплика озвучивается по предложениям: первая часть звучит сразу, остальные синтезируются следом'
    ),
    field('Адрес службы синтеза', url, 'Например, http://127.0.0.1:8179'),
    field('Громкость', volume, 'От 0 до 1'),
    field('Состояние службы', state)
  );
  const actions = el('div', 'row');
  actions.append(save, check, say);
  root.append(actions, messages);

  function show(error?: string, ok?: string): void {
    clear(messages);
    if (error !== undefined) {
      messages.append(el('div', 'message-error', error));
    }
    if (ok !== undefined) {
      messages.append(el('div', 'message-ok', ok));
    }
  }

  function renderHealth(view: TtsHealth): void {
    if (view.ok) {
      state.className = 'state state-ready';
      const engine = view.engine !== '' ? view.engine : 'служба синтеза';
      const voice = view.voice !== '' ? view.voice : 'голос по умолчанию';
      state.textContent = `${engine}, ${voice}`;
    } else {
      state.className = 'state state-error';
      state.textContent = view.error;
    }
  }

  async function refreshHealth(): Promise<void> {
    state.className = 'state state-starting';
    state.textContent = 'проверяется…';
    renderHealth(await window.tishka.speech.health());
  }

  function parseVolume(value: string, fallback: number): number {
    const number = Number(value.replace(',', '.'));
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
  }

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    enabled.checked = view.config.voice.tts.enabled;
    bySentence.checked = view.config.voice.tts.bySentence;
    url.value = view.config.voice.tts.url;
    volume.value = String(view.config.voice.tts.volume);
  }

  save.addEventListener('click', () => {
    void runWithFeedback(save, SAVE_LABELS, async () => {
      try {
        const view = await window.tishka.config.get();
        const next: Config = {
          ...view.config,
          voice: {
            ...view.config.voice,
            tts: {
              enabled: enabled.checked,
              url: url.value.trim(),
              volume: parseVolume(volume.value, view.config.voice.tts.volume),
              bySentence: bySentence.checked
            }
          }
        };
        await window.tishka.config.save(next);
        show(undefined, 'Настройки речи сохранены');
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });

  check.addEventListener('click', () => {
    void runWithFeedback(check, CHECK_LABELS, async () => {
      try {
        const view = await window.tishka.speech.health();
        renderHealth(view);
        if (!view.ok) {
          throw new Error(view.error);
        }
        show();
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });

  say.addEventListener('click', () => {
    void runWithFeedback(say, SAY_LABELS, async () => {
      try {
        await window.tishka.speech.say();
        show();
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });

  void refresh().then(
    () => refreshHealth(),
    (error: unknown) => show(error instanceof Error ? error.message : String(error))
  );

  return { refresh: () => void refresh() };
}

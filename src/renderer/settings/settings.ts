import { mountConnectionsSection } from './connections-section';
import { mountModelSection } from './model-section';
import { mountPersonaSection } from './persona-section';
import { mountVoiceSection } from './voice-section';

function section(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Не найден раздел настроек: ${id}`);
  }
  return node;
}

mountModelSection(section('model-section'));
mountVoiceSection(section('voice-section'));
mountConnectionsSection(section('connections-section'));
mountPersonaSection(section('persona-section'));

document.getElementById('settings-close')?.addEventListener('click', () => {
  void window.tishka.closeSettings();
});

document.getElementById('settings-open-chat')?.addEventListener('click', () => {
  void window.tishka.openChat();
});

// Esc закрывает редактор подключения, если он открыт, иначе — окно настроек.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }
  const editor = document.querySelector('.editor');
  if (editor !== null) {
    editor.remove();
    return;
  }
  void window.tishka.closeSettings();
});

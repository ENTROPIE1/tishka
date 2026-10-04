import { mountConnectionsSection } from '../settings/connections-section';
import { mountMemorySection } from '../settings/memory-section';
import { mountModelSection } from '../settings/model-section';
import { mountPersonaSection } from '../settings/persona-section';
import { mountVoiceSection } from '../settings/voice-section';

function section(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Не найден раздел настроек: ${id}`);
  }
  return node;
}

// Разделы настроек монтируются в экраны одного окна без изменения их содержимого.
export function mountSettingsScreens(): void {
  mountModelSection(section('model-section'));
  mountConnectionsSection(section('connections-section'));
  mountPersonaSection(section('persona-section'));
  mountMemorySection(section('memory-section'));
  mountVoiceSection(section('voice-section'));
}

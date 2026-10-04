import { combineSections, type SettingsSection } from '../settings/dom';
import { mountConnectionsSection } from '../settings/connections-section';
import { mountMemorySection } from '../settings/memory-section';
import { mountModelSection } from '../settings/model-section';
import { mountPersonaSection } from '../settings/persona-section';
import { mountVoiceSection } from '../settings/voice-section';
import type { ScreenName } from './shell';

function section(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Не найден раздел настроек: ${id}`);
  }
  return node;
}

// Разделы настроек монтируются в экраны одного окна. Каждый возвращает refresh,
// чтобы экран перечитывал данные при каждом показе.
export function mountSettingsScreens(): Partial<Record<ScreenName, SettingsSection>> {
  return {
    connections: combineSections([
      mountModelSection(section('model-section')),
      mountConnectionsSection(section('connections-section'))
    ]),
    memory: mountMemorySection(section('memory-section')),
    voice: mountVoiceSection(section('voice-section')),
    persona: mountPersonaSection(section('persona-section'))
  };
}

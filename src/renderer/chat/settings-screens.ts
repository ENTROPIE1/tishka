import { combineSections, type SettingsSection } from '../settings/dom';
import { mountConnectionsSection } from '../settings/connections-section';
import { mountMemorySection } from '../settings/memory-section';
import { mountModelSection } from '../settings/model-section';
import { mountPersonaSection } from '../settings/persona-section';
import { mountSpeechSection } from '../settings/speech-section';
import { mountVoiceSection } from '../settings/voice-section';
import { mountWebSection } from '../settings/web-section';
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
  const voiceSection = section('voice-section');
  const voice = mountVoiceSection(voiceSection);
  // Раздел речи идёт под разделом голоса и перечитывается вместе с ним.
  const speechSection = voiceSection.ownerDocument.createElement('section');
  speechSection.className = 'section';
  voiceSection.after(speechSection);
  const speech = mountSpeechSection(speechSection);
  const connectionsSection = section('connections-section');
  const webSection = connectionsSection.ownerDocument.createElement('section');
  webSection.className = 'section';
  connectionsSection.after(webSection);
  return {
    connections: combineSections([
      mountModelSection(section('model-section')),
      mountConnectionsSection(connectionsSection),
      mountWebSection(webSection)
    ]),
    memory: mountMemorySection(section('memory-section')),
    voice: combineSections([voice, speech]),
    persona: mountPersonaSection(section('persona-section'))
  };
}

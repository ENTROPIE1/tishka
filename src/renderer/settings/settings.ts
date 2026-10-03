import { mountConnectionsSection } from './connections-section';
import { mountModelSection } from './model-section';
import { mountPersonaSection } from './persona-section';

function section(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Не найден раздел настроек: ${id}`);
  }
  return node;
}

mountModelSection(section('model-section'));
mountConnectionsSection(section('connections-section'));
mountPersonaSection(section('persona-section'));

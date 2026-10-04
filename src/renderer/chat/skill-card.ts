import type { TishkaEvent } from '../../core/types';
import type { ChatFeed } from './feed';

// Карточку «Навык сохранён» показывает только сохранение в диалоге с Тишкой.
// Правки и переключатель на экране автоматизаций приходят с source 'screen'.
export function appendSkillSaveCard(feed: ChatFeed, event: TishkaEvent): boolean {
  if (event.type !== 'skill.saved' || event.source !== 'dialog') {
    return false;
  }
  feed.appendSkillCard(event.skillId);
  return true;
}

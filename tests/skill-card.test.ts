// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createChatFeed } from '../src/renderer/chat/feed';
import { appendSkillSaveCard } from '../src/renderer/chat/skill-card';

afterEach(() => {
  document.body.replaceChildren();
});

describe('appendSkillSaveCard', () => {
  it('сохранение с экрана не добавляет карточку в ленту', () => {
    const container = document.createElement('div');
    const feed = createChatFeed(container);

    const added = appendSkillSaveCard(feed, { type: 'skill.saved', skillId: 'morning', source: 'screen' });

    expect(added).toBe(false);
    expect(container.querySelector('.msg-system')).toBeNull();
    expect(container.textContent).not.toContain('Навык сохранён');
  });

  it('сохранение из диалога добавляет карточку', () => {
    const container = document.createElement('div');
    const feed = createChatFeed(container);

    const added = appendSkillSaveCard(feed, { type: 'skill.saved', skillId: 'morning', source: 'dialog' });

    expect(added).toBe(true);
    expect(container.querySelector('.msg-system')).not.toBeNull();
    expect(container.textContent).toContain('Навык сохранён');
  });
});

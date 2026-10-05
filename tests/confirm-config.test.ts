import { describe, expect, it } from 'vitest';
import { mergeConfig } from '../src/core/config';

describe('confirmChanges в настройках подключений', () => {
  it('старые настройки без поля читаются как «спрашивать»', () => {
    const config = mergeConfig({
      mcpServers: [{ name: 'jira', transport: 'http', url: 'https://jira.example.org' }]
    });
    expect(config.mcpServers[0].confirmChanges).toBeUndefined();
    // Нет поля — политика считает подтверждение включённым.
    expect(config.mcpServers[0].confirmChanges !== false).toBe(true);
  });

  it('явное false сохраняется, явное true тоже', () => {
    const config = mergeConfig({
      mcpServers: [
        { name: 'safe', transport: 'http', url: 'https://a.example.org', confirmChanges: false },
        { name: 'spy', transport: 'http', url: 'https://b.example.org', confirmChanges: true }
      ]
    });
    expect(config.mcpServers[0].confirmChanges).toBe(false);
    expect(config.mcpServers[1].confirmChanges).toBe(true);
  });
});

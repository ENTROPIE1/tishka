// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createSkillRunner } from '../src/core/skills/runner';
import { validateSkill } from '../src/core/skills/validate';
import { createToolRegistry } from '../src/core/tools/registry';
import type { Panel, Skill, ToolDef } from '../src/core/types';
import { fitMailDraftLink, LONG_BODY_HINT, DRAFT_URL_LIMIT } from '../mcp-servers/exchange/src/links';
import { installLinkGuard } from '../src/renderer/shared/links';
import { panelElement } from '../src/renderer/shared/panels';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preset = JSON.parse(readFileSync(join(root, 'presets', 'draft-letter.tishka.json'), 'utf8')) as unknown;
const skill = (() => {
  const result = validateSkill(preset);
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.skill;
})();

function registry(body: string) {
  const registry = createToolRegistry(createEventBus());
  const def: ToolDef = {
    name: 'exchange__mail_draft_link',
    description: 'ссылка',
    inputSchema: { type: 'object' },
    source: 'builtin',
    readOnly: true
  };
  registry.register(def, async () => {
    const result = fitMailDraftLink('https://mail.example.org/owa', {
      to: 'ivan@example.org',
      subject: 'Отчёт',
      body
    });
    return { ok: true, content: '{}', data: { url: result.url, hint: result.truncated ? LONG_BODY_HINT : '' } };
  });
  return registry;
}

afterEach(() => {
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
  vi.restoreAllMocks();
});

describe('путь «подготовь письмо»', () => {
  it('длинное письмо, ссылка в карточке, щелчок уходит в браузер', async () => {
    const body = 'текст письма '.repeat(300);
    const runner = createSkillRunner({
      registry: registry(body),
      ask: async () => body,
      events: createEventBus(),
      now: () => new Date('2026-10-05T09:30:00')
    });
    const result = await runner.run(skill as Skill, { to: 'ivan@example.org', topic: 'Отчёт', points: 'тезисы' });

    expect(result.ok).toBe(true);
    const panel = result.reply?.show;
    expect(panel?.kind).toBe('text');
    const markdown = panel !== undefined && panel.kind === 'text' ? panel.markdown : '';
    expect(markdown).toContain(LONG_BODY_HINT);
    expect(markdown).toContain(body);

    const openExternal = vi.fn(async () => undefined);
    (window as unknown as { tishka: unknown }).tishka = { openExternal };
    const host = document.createElement('div');
    host.append(panelElement(panel as Panel));
    document.body.append(host);
    installLinkGuard(document);

    const link = host.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).not.toBeNull();
    expect((link.dataset['url'] ?? '').length).toBeLessThanOrEqual(DRAFT_URL_LIMIT);
    expect((link.dataset['url'] ?? '').length).toBeGreaterThan(0);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(openExternal).toHaveBeenCalledWith(link.dataset['url']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupCores, replyChoice, setupCore } from './core-helpers';

describe('Config.web', () => {
  afterEach(async () => {
    await cleanupCores();
  });

  async function listedTools(enabled: boolean): Promise<string[]> {
    let tools: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { tools?: { function: { name: string } }[] };
      tools = (body.tools ?? []).map((tool) => tool.function.name);
      return replyChoice('r1', 'ок');
    });

    const { core } = await setupCore({ config: { web: { enabled } }, fetch: fetchMock });
    await core.handleUserText('привет');
    return tools;
  }

  it('при web.enabled true инструменты чтения зарегистрированы', async () => {
    const tools = await listedTools(true);
    expect(tools).toContain('wiki_search');
    expect(tools).toContain('wiki_read');
  });

  it('при web.enabled false инструменты чтения не зарегистрированы', async () => {
    const tools = await listedTools(false);
    expect(tools).toContain('reply');
    expect(tools).not.toContain('wiki_search');
    expect(tools).not.toContain('wiki_read');
    expect(tools).not.toContain('web_read');
  });
});

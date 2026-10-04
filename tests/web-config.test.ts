import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTishkaCore, type TishkaCore } from '../src/core/app';
import { createEventBus } from '../src/core/events';
import type { SecretStore } from '../src/core/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const presetsDir = join(root, 'presets');

function fakeSecrets(): SecretStore {
  const map = new Map([['DKS_API_KEY', 'test-key']]);
  return {
    async set(name, value) {
      map.set(name, value);
    },
    async get(name) {
      return map.get(name);
    },
    async has(name) {
      return map.has(name);
    },
    async delete(name) {
      map.delete(name);
    },
    async names() {
      return [...map.keys()];
    }
  };
}

function replyResponse(say: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'r1', type: 'function', function: { name: 'reply', arguments: JSON.stringify({ say }) } }
            ]
          }
        }
      ]
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('Config.web', () => {
  const dirs: string[] = [];
  const cores: TishkaCore[] = [];

  afterEach(async () => {
    while (cores.length > 0) {
      await cores.pop()?.stop();
    }
    while (dirs.length > 0) {
      await rm(String(dirs.pop()), { recursive: true, force: true });
    }
  });

  async function listedTools(enabled: boolean): Promise<string[]> {
    const dataDir = await mkdtemp(join(tmpdir(), 'tishka-web-config-'));
    dirs.push(dataDir);
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({ web: { enabled } }), 'utf8');

    let tools: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { tools?: { function: { name: string } }[] };
      tools = (body.tools ?? []).map((tool) => tool.function.name);
      return replyResponse('ок');
    });

    const core = createTishkaCore({
      dataDir,
      presetsDir,
      appRoot: root,
      secrets: fakeSecrets(),
      events: createEventBus(),
      openExternal: async () => undefined,
      showPanel: () => undefined,
      now: () => new Date('2026-10-02T10:00:00'),
      fetch: fetchMock
    });
    cores.push(core);
    await core.start();
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
    expect(tools).not.toContain('wiki_search');
    expect(tools).not.toContain('wiki_read');
    expect(tools).not.toContain('web_read');
  });
});

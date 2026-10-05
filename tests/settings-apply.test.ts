import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpConnectionFactory } from '../src/core/mcp/connection';
import type { CaptureResult } from '../src/core/vision/look';
import { cleanupCores, replyChoice, setupCore, toolChoice } from './core-helpers';

interface WireBody {
  model: string;
  tools?: Array<{ function: { name: string } }>;
}

function readBody(init: RequestInit | undefined): WireBody {
  return JSON.parse(String(init?.body)) as WireBody;
}

function toolNames(body: WireBody | undefined): string[] {
  return (body?.tools ?? []).map((tool) => tool.function.name);
}

function okCapture(): CaptureResult {
  return { ok: true, png: new Uint8Array([1, 2, 3]), width: 100, height: 100, source: 'Монитор' };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await cleanupCores();
});

describe('настройки действуют без перезапуска', () => {
  it('web.enabled=false убирает чтение страниц из инструментов и не выполняет его', async () => {
    let readCalls = 0;
    const bodies: WireBody[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(readBody(init));
      if (bodies.length === 1) {
        return toolChoice('c1', 'web_read', { url: 'https://x.example' });
      }
      return replyChoice(`r${bodies.length}`, 'прочитал');
    });
    const { core } = await setupCore({
      fetch: fetchMock,
      readWeb: async () => {
        readCalls += 1;
        return {
          ok: true,
          url: 'https://x.example',
          title: 'x',
          text: 'текст',
          truncated: false,
          links: []
        };
      }
    });

    await core.saveConfig({ ...core.config(), web: { enabled: false } });
    await core.handleUserText('прочитай страницу https://x.example');

    expect(toolNames(bodies[0])).not.toContain('web_read');
    expect(readCalls).toBe(0);
  });

  it('screen.enabled=false убирает снимок экрана из инструментов и не делает его', async () => {
    const capture = vi.fn(async () => okCapture());
    const bodies: WireBody[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(readBody(init));
      if (bodies.length === 1) {
        return toolChoice('c1', 'screen_look', {});
      }
      return replyChoice(`r${bodies.length}`, 'не смотрю');
    });
    const { core } = await setupCore({ fetch: fetchMock, captureScreen: capture });

    await core.saveConfig({ ...core.config(), screen: { enabled: false } });
    await core.handleUserText('что у меня на экране');

    expect(toolNames(bodies[0])).not.toContain('screen_look');
    expect(capture).not.toHaveBeenCalled();
  });

  it('включение web обратно возвращает web_read и чтение снова работает', async () => {
    let readCalls = 0;
    const bodies: WireBody[] = [];
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async (_url, init) => {
      bodies.push(readBody(init));
      return replyChoice(`r${bodies.length}`, 'ок');
    });
    const { core } = await setupCore({
      fetch: fetchMock,
      readWeb: async () => {
        readCalls += 1;
        return {
          ok: true,
          url: 'https://x.example',
          title: 'x',
          text: 'текст',
          truncated: false,
          links: []
        };
      }
    });

    await core.saveConfig({ ...core.config(), web: { enabled: false } });
    await core.handleUserText('раз');
    expect(toolNames(bodies[0])).not.toContain('web_read');

    await core.saveConfig({ ...core.config(), web: { enabled: true } });
    fetchMock.mockResolvedValueOnce(toolChoice('c1', 'web_read', { url: 'https://x.example' }));
    await core.handleUserText('прочитай https://x.example');

    expect(toolNames(bodies[1])).toContain('web_read');
    expect(readCalls).toBe(1);
  });

  it('смена llm.baseUrl применяется к следующему запросу без перезапуска', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      urls.push(String(url));
      return replyChoice(`r${urls.length}`, 'ок');
    });
    const { core } = await setupCore({ fetch: fetchMock });

    await core.handleUserText('первый');
    await core.saveConfig({
      ...core.config(),
      llm: { ...core.config().llm, baseUrl: 'https://new-gw.example/v1' }
    });
    await core.handleUserText('второй');

    expect(urls[1]).toContain('new-gw.example');
  });

  it('смена llm.visionModel видна в следующем запросе', async () => {
    const models: string[] = [];
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async (_url, init) => {
      models.push(readBody(init).model);
      if (models.length === 1) {
        return toolChoice('c1', 'screen_look', {});
      }
      if (models.length === 2) {
        return replyChoice('r1', 'вижу ошибку');
      }
      return replyChoice('r2', 'готово');
    });
    const { core } = await setupCore({ fetch: fetchMock, captureScreen: async () => okCapture() });

    await core.saveConfig({
      ...core.config(),
      llm: { ...core.config().llm, visionModel: 'DKS-Vision-2' }
    });
    await core.handleUserText('что на экране');

    expect(models[1]).toBe('DKS-Vision-2');
  });

  it('смена llm.api переводит запросы в формат Responses без перезапуска', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Готово' }] }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const { core } = await setupCore({ fetch: fetchMock });

    await core.handleUserText('первый');
    await core.saveConfig({
      ...core.config(),
      llm: { ...core.config().llm, api: 'responses' }
    });
    await core.handleUserText('второй');

    expect(urls[0]).toContain('/chat/completions');
    expect(urls[1].endsWith('/responses')).toBe(true);
  });
});

describe('сохранение настроек и подключения', () => {
  interface Log {
    starts: string[];
    closed: string[];
  }

  function trackingFactory(log: Log): McpConnectionFactory {
    return async (server) => {
      log.starts.push(server.name);
      return {
        listTools: async () => [],
        callTool: async () => ({ content: [] }),
        close: async () => {
          log.closed.push(server.name);
        }
      };
    };
  }

  const twoServers = [
    { name: 'confluence', transport: 'http' as const, url: 'https://wiki.example.org' },
    { name: 'exchange', transport: 'http' as const, url: 'https://mail.example.org' }
  ];

  it('смена голоса, характера или приложения не запускает и не останавливает серверы', async () => {
    const log: Log = { starts: [], closed: [] };
    const { core } = await setupCore({
      config: { mcpServers: twoServers },
      createMcpConnection: trackingFactory(log)
    });

    await core.saveConfig({
      ...core.config(),
      voice: { ...core.config().voice, tts: { ...core.config().voice.tts, enabled: true } }
    });
    await core.saveConfig({ ...core.config(), persona: { fyr: 'often' } });
    await core.saveConfig({
      ...core.config(),
      app: { ...core.config().app, warmMinutes: 45 }
    });

    expect(log.starts.sort()).toEqual(['confluence', 'exchange']);
    expect(log.closed).toEqual([]);
  });

  it('изменение подключения перезапускает только его', async () => {
    const log: Log = { starts: [], closed: [] };
    const { core } = await setupCore({
      config: { mcpServers: twoServers },
      createMcpConnection: trackingFactory(log)
    });

    await core.saveConfig({ ...core.config(), persona: { fyr: 'off' } });
    expect(log.starts).toEqual(['confluence', 'exchange']);

    const changed = core.config().mcpServers.map((server) =>
      server.name === 'confluence' ? { ...server, url: 'https://new-wiki.example.org' } : server
    );
    await core.saveConfig({ ...core.config(), mcpServers: changed });

    expect(log.starts.filter((name) => name === 'confluence')).toHaveLength(2);
    expect(log.starts.filter((name) => name === 'exchange')).toHaveLength(1);
    expect(log.closed).toEqual(['confluence']);
  });

  it('смена секрета подключения перезапускает сервер', async () => {
    const log: Log = { starts: [], closed: [] };
    const server = {
      name: 'confluence',
      transport: 'http' as const,
      url: 'https://wiki.example.org',
      headers: { Authorization: 'Bearer ${secret:CONFLUENCE_TOKEN}' }
    };
    const { core, secrets } = await setupCore({
      config: { mcpServers: [server] },
      secrets: { DKS_API_KEY: 'test-key', CONFLUENCE_TOKEN: 'first' },
      createMcpConnection: trackingFactory(log)
    });

    await core.saveConfig({ ...core.config() });
    expect(log.starts).toEqual(['confluence']);

    // Конфигурация подключения не изменилась, но значение секрета другое.
    await secrets.set('CONFLUENCE_TOKEN', 'second');
    await core.saveConfig({ ...core.config() });

    expect(log.starts).toEqual(['confluence', 'confluence']);
    expect(log.closed).toEqual(['confluence']);
  });
});


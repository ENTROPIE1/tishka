import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupCores, jsonResponse, replyChoice, setupCore, toolChoice } from './core-helpers';

const delay = (ms: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Не дождались нужного состояния');
    }
    await delay(25);
  }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await cleanupCores();
});

describe('устойчивость агента', () => {
  it('newConversation во время вызова инструмента не оставляет висячий tool-результат в контексте', async () => {
    let releaseOpen: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      releaseOpen = resolveGate;
    });
    const bodies: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) {
        return toolChoice('c1', 'open_urls', { urls: ['https://a.example'] });
      }
      return replyChoice(`r${bodies.length}`, 'ок');
    });
    const { core, openExternal } = await setupCore({ fetch: fetchMock });
    openExternal.mockImplementation(() => gate);

    const pending = core.handleUserText('открой страницу https://a.example');
    await waitFor(() => bodies.length >= 1 && openExternal.mock.calls.length > 0);

    core.newConversation();
    releaseOpen?.();
    await pending;

    await core.handleUserText('второй вопрос');

    const messages = (JSON.parse(bodies[bodies.length - 1]) as { messages: Array<{ role: string }> }).messages;
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('content: "" без вызовов инструментов даёт понятную реплику, а не пустое облачко', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: '' } }] }));
    const { core } = await setupCore({ fetch: fetchMock });

    const reply = await core.handleUserText('привет');

    expect(reply.say.length).toBeGreaterThan(0);
    expect(reply.mood).toBe('confused');
  });

  it('content: null без вызовов инструментов даёт понятную реплику', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: null } }] }));
    const { core } = await setupCore({ fetch: fetchMock });

    const reply = await core.handleUserText('привет');

    expect(reply.say.length).toBeGreaterThan(0);
    expect(reply.mood).toBe('confused');
  });
});

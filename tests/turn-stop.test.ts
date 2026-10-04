import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureResult } from '../src/core/vision/look';
import {
  cleanupCores,
  replyChoice,
  setupCore,
  toolChoice
} from './core-helpers';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Не дождались нужного состояния');
    }
    await delay(10);
  }
}

afterEach(async () => {
  await cleanupCores();
});

// Первый запрос держится, пока его не прервут или не отпустят, остальные отвечают сразу.
function hangingFetch(): { fetch: ReturnType<typeof vi.fn<typeof fetch>>; release: () => void } {
  let release: () => void = () => undefined;
  const fetchMock = vi.fn<typeof fetch>();
  fetchMock.mockImplementationOnce((_url, init) => {
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      release = () => resolve(replyChoice('r1', 'первый'));
    });
  });
  fetchMock.mockResolvedValue(replyChoice('r2', 'готово'));
  return { fetch: fetchMock, release: () => release() };
}

describe('очередь ходов и остановка', () => {
  it('два одинаковых запроса подряд — выполняется один', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => replyChoice('r1', 'отвечаю'));
    const { core } = await setupCore({ fetch: fetchMock });

    const [first, second] = await Promise.all([
      core.handleUserText('посмотри, что у меня на экране'),
      core.handleUserText('посмотри, что у меня на экране')
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('одинаковая реплика, ждущая в очереди, второй раз не ставится', async () => {
    const { fetch: fetchMock, release } = hangingFetch();
    const { core } = await setupCore({ fetch: fetchMock });

    const first = core.handleUserText('первый вопрос');
    await waitFor(() => fetchMock.mock.calls.length === 1);
    const second = core.handleUserText('второй вопрос');
    const duplicate = core.handleUserText('второй вопрос');

    release();
    await Promise.all([first, second, duplicate]);

    const bodies = fetchMock.mock.calls.map((call) => String(call[1]?.body));
    expect(bodies.filter((body) => body.includes('второй вопрос'))).toHaveLength(1);
    expect(await duplicate).toBe(await second);
  });

  it('новая реплика заменяет ждущую, выполняющаяся не прерывается', async () => {
    const { fetch: fetchMock, release } = hangingFetch();
    const { core } = await setupCore({ fetch: fetchMock });

    const first = core.handleUserText('первый вопрос');
    await waitFor(() => fetchMock.mock.calls.length === 1);
    const second = core.handleUserText('второй вопрос');
    const third = core.handleUserText('третий вопрос');

    release();
    await Promise.all([first, second, third]);

    const bodies = fetchMock.mock.calls.map((call) => String(call[1]?.body));
    expect(bodies.some((body) => body.includes('второй вопрос'))).toBe(false);
    expect(bodies.some((body) => body.includes('третий вопрос'))).toBe(true);
    // заменённая реплика не зависает и не отвечает по существу
    expect((await second).say).not.toBe('второй вопрос');
  });

  it('отмена прерывает идущий запрос к модели, шлёт «Остановлено» и простой без ошибки', async () => {
    const { fetch: fetchMock } = hangingFetch();
    const { core, events } = await setupCore({ fetch: fetchMock });

    const turn = core.handleUserText('думай долго');
    await waitFor(() => fetchMock.mock.calls.length === 1);
    core.cancel();

    const reply = await turn;

    expect(reply.say).toBe('Остановлено');
    expect(events.some((event) => event.type === 'notify' && event.title === 'Остановлено')).toBe(true);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.at(-1)?.type).toBe('idle');
  });

  it('отмена очищает очередь: ждущая реплика не выполняется', async () => {
    const { fetch: fetchMock, release } = hangingFetch();
    const { core } = await setupCore({ fetch: fetchMock });

    const first = core.handleUserText('первый вопрос');
    await waitFor(() => fetchMock.mock.calls.length === 1);
    const second = core.handleUserText('второй вопрос');
    core.cancel();

    release();
    await Promise.all([first, second]);

    const bodies = fetchMock.mock.calls.map((call) => String(call[1]?.body));
    expect(bodies.some((body) => body.includes('второй вопрос'))).toBe(false);
    expect((await second).say).toBe('Остановлено');
  });

  it('отмена во время инструмента: следующий запрос проходит без оборванного вызова', async () => {
    const capture = vi.fn(async () => new Promise<CaptureResult>(() => undefined));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      toolChoice('c1', 'screen_look', { question: 'что видно' })
    );
    const { core, events } = await setupCore({ fetch: fetchMock, captureScreen: capture });

    const turn = core.handleUserText('посмотри на экран');
    await waitFor(() => capture.mock.calls.length === 1);
    core.cancel();
    await turn;

    fetchMock.mockResolvedValueOnce(replyChoice('r2', 'готово'));
    const reply = await core.handleUserText('второй вопрос');

    expect(reply.say).toBe('готово');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(body).not.toContain('tool_calls');
    expect(events.some((event) => event.type === 'notify' && event.title === 'Остановлено')).toBe(true);
  });

  it('отмена без работы не делает ничего, кроме простоя', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => replyChoice('r1', 'ок'));
    const { core, events } = await setupCore({ fetch: fetchMock });

    core.cancel();

    expect(events).toEqual([{ type: 'idle' }]);
  });
});

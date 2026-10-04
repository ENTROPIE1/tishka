import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../src/core/agent/agent';
import { replyFromToolArgs } from '../src/core/agent/reply';
import { createEventBus } from '../src/core/events';
import type { ChatRequest, ChatResponse, ToolCall } from '../src/core/llm/client';
import type { Reply, ToolDef, ToolRegistry, ToolResult, TishkaEvent } from '../src/core/types';

const NOW = new Date('2026-10-03T09:30:00');

const echoDef: ToolDef = {
  name: 'echo',
  description: 'Возвращает переданный текст',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  source: 'builtin',
  readOnly: true
};

function makeRegistry(): ToolRegistry {
  return {
    register: vi.fn(),
    unregisterSource: vi.fn(),
    list: () => [echoDef],
    call: vi.fn(async (): Promise<ToolResult> => ({ ok: true, content: 'эхо' }))
  };
}

function makeAgent(toolCallArgs: Record<string, unknown>): {
  agent: ReturnType<typeof createAgent>;
  events: TishkaEvent[];
  requests: ChatRequest[];
} {
  const events = createEventBus();
  const emitted: TishkaEvent[] = [];
  events.on((event) => emitted.push(event));
  const requests: ChatRequest[] = [];
  const call: ToolCall = { id: 'r1', name: 'reply', args: toolCallArgs };
  const llm = {
    chat: vi.fn(async (req: ChatRequest): Promise<ChatResponse> => {
      requests.push(req);
      return { text: null, toolCalls: [call] };
    })
  };
  return {
    agent: createAgent({ llm, registry: makeRegistry(), events, getModel: () => 'dks-local', now: () => NOW }),
    events: emitted,
    requests
  };
}

describe('reply с ask', () => {
  it('ask из аргументов попадает в ответ и в событие reply', async () => {
    const ask = { title: 'Текст для итога недели', placeholder: 'Заметки за неделю' };
    const { agent, events } = makeAgent({ say: 'Пришли заметки', ask });

    const answer = await agent.handle('отформатируй итог недели');

    expect(answer.ask).toEqual(ask);
    expect(events).toContainEqual({ type: 'reply', reply: { say: 'Пришли заметки', mood: 'neutral', ask } });
  });

  it('ask и show в одном ответе допустимы', async () => {
    const panel = { kind: 'text', title: 'Черновик', markdown: 'текст' };
    const ask = { title: 'Что дополнить?' };
    const { agent } = makeAgent({ say: 'Посмотри', show: panel, ask });

    const answer = await agent.handle('дополни');

    expect(answer.show).toEqual(panel);
    expect(answer.ask).toEqual(ask);
  });

  it('ask без title отбрасывается, ответ остаётся рабочим', () => {
    const reply: Reply = replyFromToolArgs({ say: 'Готово', ask: { placeholder: 'текст' } }, null);

    expect(reply).toEqual({ say: 'Готово', mood: 'neutral' });
    expect(reply.ask).toBeUndefined();
  });

  it('нестроковый placeholder убирается, а title сохраняется', () => {
    const reply = replyFromToolArgs({ say: 'Жду', ask: { title: 'Пришли текст', placeholder: 5 } }, null);

    expect(reply.ask).toEqual({ title: 'Пришли текст' });
  });

  it('системное сообщение содержит правило про ask', async () => {
    const { agent, requests } = makeAgent({ say: 'Готово' });

    await agent.handle('привет');

    const system = requests[0].messages[0];
    const content = system.role === 'system' && typeof system.content === 'string' ? system.content : '';
    expect(content).toContain('ask');
  });
});

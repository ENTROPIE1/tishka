import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../src/core/agent/agent';
import { createEventBus } from '../src/core/events';
import {
  LlmError,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ToolCall
} from '../src/core/llm/client';
import type { Panel, Reply, ToolDef, ToolRegistry, ToolResult, TishkaEvent } from '../src/core/types';

const NOW = new Date('2026-10-03T09:30:00');

const echoDef: ToolDef = {
  name: 'echo',
  description: 'Возвращает переданный текст',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text']
  },
  source: 'builtin',
  readOnly: true
};

function makeRegistry(result: ToolResult = { ok: true, content: 'эхо' }): {
  registry: ToolRegistry;
  calls: { name: string; args: Record<string, unknown> }[];
} {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const registry: ToolRegistry = {
    register: vi.fn(),
    unregisterSource: vi.fn(),
    list: () => [echoDef],
    call: vi.fn(async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      calls.push({ name, args });
      return result;
    })
  };
  return { registry, calls };
}

function makeLlm(step: (round: number) => ChatResponse): {
  llm: { chat(req: ChatRequest): Promise<ChatResponse> };
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  const llm = {
    chat: vi.fn(async (req: ChatRequest): Promise<ChatResponse> => {
      requests.push(req);
      return step(requests.length - 1);
    })
  };
  return { llm, requests };
}

function textResponse(text: string): ChatResponse {
  return { text, toolCalls: [] };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, args };
}

function replyCall(id: string, args: { say: string; show?: Panel; mood?: string }): ToolCall {
  return toolCall(id, 'reply', args as Record<string, unknown>);
}

function toolMessages(history: ChatMessage[]): Extract<ChatMessage, { role: 'tool' }>[] {
  return history.filter((message): message is Extract<ChatMessage, { role: 'tool' }> => message.role === 'tool');
}

function makeAgent(llm: { chat(req: ChatRequest): Promise<ChatResponse> }, registry: ToolRegistry): {
  agent: ReturnType<typeof createAgent>;
  events: TishkaEvent[];
} {
  const events = createEventBus();
  const emitted: TishkaEvent[] = [];
  events.on((event) => emitted.push(event));
  return {
    agent: createAgent({ llm, registry, events, getModel: () => 'dks-local', now: () => NOW }),
    events: emitted
  };
}

describe('createAgent', () => {
  it('модель сразу вызывает reply — возвращается этот Reply, реестр не вызывался', async () => {
    const expected: Reply = { say: 'Готово, всё сделал', mood: 'happy' };
    const { registry, calls } = makeRegistry();
    const { llm, requests } = makeLlm(() => ({ text: null, toolCalls: [replyCall('r1', expected)] }));
    const { agent, events } = makeAgent(llm, registry);

    const answer = await agent.handle('привет');

    expect(answer).toEqual(expected);
    expect(calls).toHaveLength(0);
    expect(registry.call).not.toHaveBeenCalled();
    expect(requests[0].tools?.map((def) => def.name)).toContain('reply');
    expect(events).toContainEqual({ type: 'reply', reply: expected });
  });

  it('модель вызывает инструмент, потом reply — инструмент выполнен один раз, результат в истории', async () => {
    const { registry, calls } = makeRegistry({ ok: true, content: 'эхо: раз' });
    const { llm, requests } = makeLlm((round) =>
      round === 0
        ? { text: null, toolCalls: [toolCall('t1', 'echo', { text: 'раз' })] }
        : { text: null, toolCalls: [replyCall('r1', { say: 'Сделал' })] }
    );
    const { agent } = makeAgent(llm, registry);

    const answer = await agent.handle('скажи раз');

    expect(answer).toEqual({ say: 'Сделал', mood: 'neutral' });
    expect(calls).toEqual([{ name: 'echo', args: { text: 'раз' } }]);
    expect(toolMessages(agent.history())[0].content).toContain('эхо: раз');
    expect(requests[1].messages.some((m) => m.role === 'tool' && m.content.includes('эхо: раз'))).toBe(true);
  });

  it('модель отвечает длинным текстом — say из двух предложений, полный текст в show', async () => {
    const full = 'Первое предложение. Второе предложение. Третье предложение. Четвёртое предложение.';
    const { registry } = makeRegistry();
    const { llm } = makeLlm(() => textResponse(full));
    const { agent } = makeAgent(llm, registry);

    const answer = await agent.handle('расскажи');

    expect(answer.say).toBe('Первое предложение. Второе предложение.');
    expect(answer.show).toEqual({ kind: 'text', title: 'Ответ', markdown: full });
  });

  it('модель отвечает коротким текстом — весь текст в say, панели нет', async () => {
    const short = 'Сделал, фыр. Что-нибудь ещё?';
    const { registry } = makeRegistry();
    const { llm } = makeLlm(() => textResponse(short));
    const { agent } = makeAgent(llm, registry);

    const answer = await agent.handle('как дела');

    expect(answer).toEqual({ say: short, mood: 'neutral' });
  });

  it('модель бесконечно вызывает инструменты — цикл останавливается на восьмом круге', async () => {
    const { registry, calls } = makeRegistry();
    const { llm } = makeLlm((round) => ({
      text: null,
      toolCalls: [toolCall(`t${round}`, 'echo', { text: String(round) })]
    }));
    const { agent, events } = makeAgent(llm, registry);

    const answer = await agent.handle('зациклись');

    expect(answer).toEqual({ say: 'Не получилось, слишком много шагов', mood: 'confused' });
    expect(calls).toHaveLength(8);
    expect(llm.chat).toHaveBeenCalledTimes(8);
    expect(events.filter((event) => event.type === 'think.start')).toHaveLength(8);
  });

  it('сбой инструмента попадает в историю как результат, цикл продолжается', async () => {
    const { registry, calls } = makeRegistry({ ok: false, content: '', error: 'всё сломалось' });
    const { llm } = makeLlm((round) =>
      round === 0
        ? { text: null, toolCalls: [toolCall('t1', 'echo', { text: 'раз' })] }
        : { text: null, toolCalls: [replyCall('r1', { say: 'Сделал' })] }
    );
    const { agent } = makeAgent(llm, registry);

    const answer = await agent.handle('сбой');

    expect(calls).toHaveLength(1);
    expect(answer).toEqual({ say: 'Сделал', mood: 'neutral' });
    expect(toolMessages(agent.history()).some((m) => m.content.includes('всё сломалось'))).toBe(true);
  });

  it('простой вопрос об экране отвечает за один шаг прямым ответом', async () => {
    const { registry, calls } = makeRegistry({
      ok: true,
      content: 'Открыт редактор и терминал',
      reply: { say: 'Открыт редактор', mood: 'neutral' }
    });
    const { llm } = makeLlm(() => ({
      text: null,
      toolCalls: [toolCall('t1', 'screen_look', { answer_directly: true })]
    }));
    const { agent, events } = makeAgent(llm, registry);

    const answer = await agent.handle('что на экране');

    expect(answer).toEqual({ say: 'Открыт редактор', mood: 'neutral' });
    expect(calls).toHaveLength(1);
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'reply', reply: { say: 'Открыт редактор', mood: 'neutral' } });
    expect(toolMessages(agent.history())[0].content).toContain('Открыт редактор');
  });

  it('составная просьба не обрывается прямым ответом: оба результата уходят модели', async () => {
    const screenDef: ToolDef = {
      name: 'screen_look',
      description: 'снимок экрана',
      inputSchema: { type: 'object', properties: {} },
      source: 'builtin',
      readOnly: true
    };
    const memoryDef: ToolDef = {
      name: 'memory_write',
      description: 'запись в память',
      inputSchema: { type: 'object', properties: {} },
      source: 'builtin',
      readOnly: false
    };
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const registry: ToolRegistry = {
      register: vi.fn(),
      unregisterSource: vi.fn(),
      list: () => [screenDef, memoryDef],
      call: vi.fn(async (name: string): Promise<ToolResult> => {
        calls.push({ name, args: {} });
        return name === 'screen_look'
          ? { ok: true, content: 'Открыт редактор', reply: { say: 'Открыт редактор', mood: 'neutral' } }
          : { ok: true, content: 'Записал в память' };
      })
    };
    const { llm } = makeLlm((round) =>
      round === 0
        ? {
            text: null,
            toolCalls: [
              toolCall('t1', 'screen_look', { answer_directly: true }),
              toolCall('t2', 'memory_write', { text: 'на экране редактор' })
            ]
          }
        : { text: null, toolCalls: [replyCall('r1', { say: 'Посмотрел и записал' })] }
    );
    const { agent, events } = makeAgent(llm, registry);

    const answer = await agent.handle('посмотри на экран и запиши в память');

    expect(calls).toHaveLength(2);
    expect(answer).toEqual({ say: 'Посмотрел и записал', mood: 'neutral' });
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(events).not.toContainEqual({ type: 'reply', reply: { say: 'Открыт редактор', mood: 'neutral' } });
    const tools = toolMessages(agent.history());
    expect(tools[0].content).toContain('Открыт редактор');
    expect(tools[1].content).toContain('Записал в память');
  });

  it('вызов из навыка не обрывается прямым ответом', async () => {
    const skillDef: ToolDef = {
      name: 'skill__look-and-note',
      description: 'навык: посмотреть и записать',
      inputSchema: { type: 'object', properties: {} },
      source: 'skill',
      readOnly: false
    };
    const registry: ToolRegistry = {
      register: vi.fn(),
      unregisterSource: vi.fn(),
      list: () => [skillDef],
      call: vi.fn(async (): Promise<ToolResult> => ({
        ok: true,
        content: 'Навык выполнился',
        reply: { say: 'Открыт редактор', mood: 'neutral' }
      }))
    };
    const { llm } = makeLlm((round) =>
      round === 0
        ? { text: null, toolCalls: [toolCall('t1', 'skill__look-and-note', {})] }
        : { text: null, toolCalls: [replyCall('r1', { say: 'Навык выполнился' })] }
    );
    const { agent, events } = makeAgent(llm, registry);

    const answer = await agent.handle('запусти навык');

    expect(answer).toEqual({ say: 'Навык выполнился', mood: 'neutral' });
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(events).not.toContainEqual({ type: 'reply', reply: { say: 'Открыт редактор', mood: 'neutral' } });
  });

  it('ошибочный результат с готовым ответом ход не завершает', async () => {
    const { registry, calls } = makeRegistry({ ok: false, content: '', reply: { say: 'нет' }, error: 'сбой' });
    const { llm } = makeLlm((round) =>
      round === 0
        ? { text: null, toolCalls: [toolCall('t1', 'echo', { text: 'раз' })] }
        : { text: null, toolCalls: [replyCall('r1', { say: 'Сделал' })] }
    );
    const { agent } = makeAgent(llm, registry);

    const answer = await agent.handle('сбой');

    expect(answer).toEqual({ say: 'Сделал', mood: 'neutral' });
    expect(calls).toHaveLength(1);
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it('LlmError возвращает Reply с mood confused и понятное событие error', async () => {
    const { registry } = makeRegistry();
    const llm = {
      chat: vi.fn(async (): Promise<ChatResponse> => {
        throw new LlmError('network', 'нет сети');
      })
    };
    const { agent, events } = makeAgent(llm, registry);

    const answer = await agent.handle('привет');

    expect(answer.mood).toBe('confused');
    const error = events.find((event): event is Extract<TishkaEvent, { type: 'error' }> => event.type === 'error');
    expect(error?.message).toContain('Шлюз недоступен');
    expect(error?.message).not.toContain('нет сети');
  });

  it('ошибка сервера называет модель и ведёт в настройки', async () => {
    const { registry } = makeRegistry();
    const llm = {
      chat: vi.fn(async (): Promise<ChatResponse> => {
        throw new LlmError('server', 'Шлюз моделей недоступен, код ответа 500');
      })
    };
    const { agent, events } = makeAgent(llm, registry);

    const answer = await agent.handle('привет');

    expect(answer.mood).toBe('confused');
    const error = events.find((event): event is Extract<TishkaEvent, { type: 'error' }> => event.type === 'error');
    expect(error?.message).toContain('dks-local');
    expect(error?.message).toContain('ошибка сервера');
    expect(error?.message).toContain('Подключениях');
  });

  it('ошибка модели картинок называет её имя, а не основную', async () => {
    const { registry } = makeRegistry();
    const llm = {
      chat: vi.fn(async (): Promise<ChatResponse> => {
        throw new LlmError('server', 'Шлюз моделей недоступен, код ответа 500', false, 'DKS-Vision');
      })
    };
    const { agent, events } = makeAgent(llm, registry);

    await agent.handle('что на экране');

    const error = events.find((event): event is Extract<TishkaEvent, { type: 'error' }> => event.type === 'error');
    expect(error?.message).toContain('DKS-Vision');
    expect(error?.message).not.toContain('dks-local');
  });

  it('длинный результат инструмента обрезается с пометкой', async () => {
    const long = 'х'.repeat(7000);
    const { registry, calls } = makeRegistry({ ok: true, content: long });
    const { llm } = makeLlm((round) =>
      round === 0
        ? { text: null, toolCalls: [toolCall('t1', 'echo', { text: 'длинно' })] }
        : { text: null, toolCalls: [replyCall('r1', { say: 'Сделал' })] }
    );
    const { agent } = makeAgent(llm, registry);

    await agent.handle('обрежь');

    expect(calls).toHaveLength(1);
    const first = toolMessages(agent.history())[0];
    expect(first.content).toContain('обрезано');
    expect(first.content.length).toBeLessThan(long.length);
    expect(first.content.startsWith('х'.repeat(6000))).toBe(true);
  });

  it('первое сообщение — системное, с датой и правилами Тишки', async () => {
    const { registry } = makeRegistry();
    const { llm, requests } = makeLlm(() => textResponse('Коротко'));
    const { agent } = makeAgent(llm, registry);

    await agent.handle('привет');

    const system = requests[0].messages[0];
    expect(system.role).toBe('system');
    const content = system.role === 'system' && typeof system.content === 'string' ? system.content : '';
    expect(content).toContain('Тишка');
    expect(content).toContain('reply');
    expect(content).toContain('черновиком');
    expect(content).toContain('октября');
    expect(content).toContain('history_search');
  });

  it('история хранит не больше 40 сообщений, системное не вытесняется', async () => {
    const { registry } = makeRegistry();
    const { llm } = makeLlm(() => textResponse('Коротко'));
    const { agent } = makeAgent(llm, registry);

    for (let turn = 0; turn < 25; turn += 1) {
      await agent.handle(`вопрос ${turn}`);
    }

    const history = agent.history();
    expect(history.length).toBeLessThanOrEqual(40);
    expect(history[0].role).toBe('system');
    expect(history.some((m) => m.role === 'user' && m.content === 'вопрос 0')).toBe(false);
    expect(history.some((m) => m.role === 'user' && m.content === 'вопрос 24')).toBe(true);
  });

  it('reset очищает историю', async () => {
    const { registry } = makeRegistry();
    const { llm } = makeLlm(() => textResponse('Коротко'));
    const { agent } = makeAgent(llm, registry);

    await agent.handle('привет');
    expect(agent.history().length).toBeGreaterThan(0);

    agent.reset();

    expect(agent.history()).toEqual([]);
  });

  it('длинное сообщение человека после ответа сокращено в контексте', async () => {
    const { registry } = makeRegistry();
    const { llm } = makeLlm(() => textResponse('Коротко'));
    const { agent } = makeAgent(llm, registry);
    const long = 'а'.repeat(5000);

    await agent.handle(long);

    const user = agent.history().find((message) => message.role === 'user');
    expect(typeof user?.content).toBe('string');
    expect(user?.content).toContain('длинный текст сокращён');
    expect((user?.content as string).startsWith('а'.repeat(300))).toBe(true);
    expect((user?.content as string).length).toBeLessThan(500);
  });

  it('объём контекста ограничен, системное на месте, ответ инструмента без вызова не остаётся', async () => {
    const { registry } = makeRegistry({ ok: true, content: 'х'.repeat(6000) });
    const { llm } = makeLlm((round) =>
      round === 0
        ? { text: null, toolCalls: [toolCall('t1', 'echo', { text: 'большой' })] }
        : textResponse('Коротко')
    );
    const { agent } = makeAgent(llm, registry);

    for (let turn = 0; turn < 12; turn += 1) {
      await agent.handle('в'.repeat(3000));
    }

    const history = agent.history();
    const volume = history
      .filter((message) => message.role !== 'system')
      .reduce((total, message) => total + (typeof message.content === 'string' ? message.content.length : 0), 0);

    expect(volume).toBeLessThanOrEqual(24_000);
    expect(history[0].role).toBe('system');
    expect(history[0].role === 'system' && history[0].content).toContain('Тишка');

    const callIds = new Set<string>();
    for (const message of history) {
      if (message.role === 'assistant' && message.toolCalls !== undefined) {
        for (const call of message.toolCalls) {
          callIds.add(call.id);
        }
      }
    }
    const orphanTools = history.filter(
      (message) => message.role === 'tool' && !callIds.has(message.toolCallId)
    );
    expect(orphanTools).toEqual([]);
  });
});

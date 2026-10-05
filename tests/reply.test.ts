import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../src/core/agent/agent';
import { EMPTY_REPLY, replyFromText, replyFromToolArgs, stripMoodMarks } from '../src/core/agent/reply';
import { buildSystemPrompt } from '../src/core/agent/prompt';
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

  it('reply без say и без панели даёт понятную реплику с mood confused', () => {
    const reply = replyFromToolArgs({}, null);

    expect(reply).toEqual(EMPTY_REPLY);
  });

  it('reply с пустым say, но с панелью — панель показывается, say не подменяется', () => {
    const panel = { kind: 'text', title: 'Черновик', markdown: 'текст' } as const;
    const reply = replyFromToolArgs({ say: '', show: panel }, null);

    expect(reply.show).toEqual(panel);
    expect(reply.say).toBe('');
    expect(reply.say).not.toBe(EMPTY_REPLY.say);
  });

  it('пустой текст модели превращается в понятную реплику', () => {
    expect(replyFromText('')).toEqual(EMPTY_REPLY);
    expect(replyFromText('   ')).toEqual(EMPTY_REPLY);
  });

  it('системное сообщение содержит правило про ask', async () => {
    const { agent, requests } = makeAgent({ say: 'Готово' });

    await agent.handle('привет');

    const system = requests[0].messages[0];
    const content = system.role === 'system' && typeof system.content === 'string' ? system.content : '';
    expect(content).toContain('ask');
  });
});

describe('метки эмоций в реплике', () => {
  it('метка посреди реплики вырезается, позиция остаётся', () => {
    const result = stripMoodMarks('Сейчас посмотрю. [happy] Нашёл!');

    expect(result.text).toBe('Сейчас посмотрю. Нашёл!');
    expect(result.text).not.toContain('[');
    expect(result.moods).toEqual([{ at: 'Сейчас посмотрю. '.length, mood: 'happy' }]);
  });

  it('неизвестное имя просто убирается', () => {
    const result = stripMoodMarks('[dance] Привет');

    expect(result.text).toBe('Привет');
    expect(result.moods).toEqual([]);
  });

  it('метка в начале и в конце', () => {
    const result = stripMoodMarks('[happy] Ура! [confused]');

    expect(result.text).toBe('Ура!');
    expect(result.moods.map((mark) => mark.mood)).toEqual(['happy', 'confused']);
    expect(result.moods[0].at).toBe(0);
    expect(result.moods[1].at).toBe(result.text.length);
  });

  it('метки попадают в ответ инструмента, но не в say', () => {
    const reply = replyFromToolArgs({ say: 'Готово. [happy] Открыл.' }, null);

    expect(reply.say).toBe('Готово. Открыл.');
    expect(reply.moods).toEqual([{ at: 'Готово. '.length, mood: 'happy' }]);
  });

  it('текстовый ответ тоже очищается от меток', () => {
    const reply = replyFromText('Готово. [confused] Не вышло.');

    expect(reply.say).not.toContain('[');
    expect(reply.moods?.[0].mood).toBe('confused');
  });

  it('без меток объект ответа не меняется', () => {
    const reply = replyFromToolArgs({ say: 'Готово' }, null);

    expect(reply).toEqual({ say: 'Готово', mood: 'neutral' });
    expect(reply.moods).toBeUndefined();
  });

  it('ссылка markdown не принимается за метку и остаётся как есть', () => {
    const result = stripMoodMarks('Читай [docs](https://example.org) дальше');

    expect(result.text).toBe('Читай [docs](https://example.org) дальше');
    expect(result.moods).toEqual([]);
  });

  it('сноска и слово с цифрами в скобках остаются', () => {
    expect(stripMoodMarks('Факт [1] и [2a]')).toEqual({ text: 'Факт [1] и [2a]', moods: [] });
    expect(stripMoodMarks('вариант [a] тут').text).toBe('вариант [a] тут');
    expect(stripMoodMarks('два слова [очень длинное имя]').text).toBe('два слова [очень длинное имя]');
  });

  it('метка с круглой скобкой сразу после не считается эмоцией', () => {
    const result = stripMoodMarks('Пометка [happy](тест)');

    expect(result.text).toBe('Пометка [happy](тест)');
    expect(result.moods).toEqual([]);
  });

  it('в карточке текстового ответа ссылки сохраняются, метка вырезается', () => {
    const reply = replyFromText('Раз. Два. [happy] Три [docs](https://example.org).');
    const panel = reply.show;

    expect(panel?.kind).toBe('text');
    if (panel?.kind === 'text') {
      expect(panel.markdown).toContain('[docs](https://example.org)');
      expect(panel.markdown).not.toContain('[happy]');
    }
    expect(reply.moods?.[0].mood).toBe('happy');
  });

  it('подсказка Тишке называет эмоции и правило метки, ежу — нет', () => {
    const tishka = buildSystemPrompt(NOW, 'sometimes', undefined, undefined, {
      speechMode: 'voice',
      userSource: 'voice',
      character: 'tishka'
    });
    const hedgehog = buildSystemPrompt(NOW, 'sometimes', undefined, undefined, {
      speechMode: 'voice',
      userSource: 'voice',
      character: 'hedgehog'
    });

    expect(tishka).toContain('Метку [эмоция]');
    expect(tishka).toContain('happy');
    expect(hedgehog).not.toContain('Метку [эмоция]');
  });
});

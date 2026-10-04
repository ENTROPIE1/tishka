import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatRequest } from '../src/core/llm/client';
import {
  parseResponsesResponse,
  responseFromEventStream,
  toResponsesRequest
} from '../src/core/llm/responses-format';
import { LlmError } from '../src/core/llm/protocol';
import type { ToolDef } from '../src/core/types';

const echoTool: ToolDef = {
  name: 'echo',
  description: 'Эхо',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  source: 'builtin',
  readOnly: true
};

describe('toResponsesRequest: сообщения', () => {
  it('системное сообщение уходит в instructions, остальные — в input', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Ты помощник' },
      { role: 'user', content: 'привет' }
    ];
    const body = toResponsesRequest({ model: 'm', messages });
    expect(body.instructions).toBe('Ты помощник');
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'привет' }] }]);
  });

  it('сообщение с картинкой превращается в input_image со строкой data:', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'что на картинке' },
          { type: 'image', dataUrl: 'data:image/png;base64,AAAA' }
        ]
      }
    ];
    const body = toResponsesRequest({ model: 'm', messages });
    expect(body.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'что на картинке' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }
        ]
      }
    ]);
  });
  it('текст ассистента превращается в output_text', () => {
    const body = toResponsesRequest({ model: 'm', messages: [{ role: 'assistant', content: 'Готово' }] });
    expect(body.input).toEqual([{ role: 'assistant', content: [{ type: 'output_text', text: 'Готово' }] }]);
  });

  it('вызов инструмента ассистентом превращается в function_call со строкой аргументов', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'echo', args: { text: 'раз' } }] }
    ];
    const body = toResponsesRequest({ model: 'm', messages });
    expect(body.input).toEqual([{ type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"раз"}' }]);
  });

  it('ассистент с текстом и вызовом даёт output_text и function_call', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'Смотрю', toolCalls: [{ id: 'c1', name: 'echo', args: {} }] }
    ];
    const body = toResponsesRequest({ model: 'm', messages });
    expect(body.input).toEqual([
      { role: 'assistant', content: [{ type: 'output_text', text: 'Смотрю' }] },
      { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{}' }
    ]);
  });

  it('результат инструмента превращается в function_call_output', () => {
    const body = toResponsesRequest({
      model: 'm',
      messages: [{ role: 'tool', toolCallId: 'c1', content: 'эхо' }]
    });
    expect(body.input).toEqual([{ type: 'function_call_output', call_id: 'c1', output: 'эхо' }]);
  });
});

describe('toResponsesRequest: параметры запроса', () => {
  it('инструменты передаются плоским видом, без вложенного function', () => {
    const body = toResponsesRequest({ model: 'm', messages: [], tools: [echoTool] });
    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'echo',
        description: 'Эхо',
        parameters: { type: 'object', properties: { text: { type: 'string' } } }
      }
    ]);
  });

  it('без инструментов и без системы лишних полей нет', () => {
    const body = toResponsesRequest({ model: 'm', messages: [{ role: 'user', content: 'привет' }] });
    expect(body.instructions).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it('tool_choice передаётся как есть, max_tokens превращается в max_output_tokens', () => {
    const req: ChatRequest = { model: 'm', messages: [], toolChoice: 'required', temperature: 0.5 };
    const body = toResponsesRequest(req, { maxTokens: 16 });
    expect(body.tool_choice).toBe('required');
    expect(body.temperature).toBe(0.5);
    expect(body.max_output_tokens).toBe(16);
  });

  it('в запросе всегда store: false и stream: false', () => {
    const body = toResponsesRequest({ model: 'm', messages: [] });
    expect(body.store).toBe(false);
    expect(body.stream).toBe(false);
  });
});

function messageWith(parts: unknown[]): unknown {
  return { output: [{ type: 'message', content: parts }] };
}

describe('parseResponsesResponse', () => {
  it('текст собирается из частей output_text', () => {
    const payload = messageWith([{ type: 'output_text', text: 'Привет, ' }, { type: 'output_text', text: 'друг' }]);
    expect(parseResponsesResponse(payload)).toEqual({ text: 'Привет, друг', toolCalls: [] });
  });

  it('два вызова инструментов разбираются в toolCalls с идентификаторами', () => {
    const payload = {
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"раз"}' },
        { type: 'function_call', call_id: 'c2', name: 'reply', arguments: '{"say":"Готово"}' }
      ]
    };
    expect(parseResponsesResponse(payload)).toEqual({
      text: null,
      toolCalls: [
        { id: 'c1', name: 'echo', args: { text: 'раз' } },
        { id: 'c2', name: 'reply', args: { say: 'Готово' } }
      ]
    });
  });

  it('элементы reasoning пропускаются, битые аргументы дают пустой объект', () => {
    const payload = {
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{это не json' }
      ]
    };
    expect(parseResponsesResponse(payload)).toEqual({
      text: null,
      toolCalls: [{ id: 'c1', name: 'echo', args: {} }]
    });
  });

  it('пустой output даёт ошибку «непонятный ответ»', () => {
    const fail = (): unknown => parseResponsesResponse({ output: [] });
    expect(fail).toThrowError(LlmError);
    expect(fail).toThrowError('Шлюз моделей вернул ответ неожиданного вида');
  });

  it('ответ неожиданного вида даёт ту же ошибку', () => {
    expect(() => parseResponsesResponse(null)).toThrowError(LlmError);
    expect(() => parseResponsesResponse({ choices: [] })).toThrowError(LlmError);
    expect(() => parseResponsesResponse({ output: 'нет' })).toThrowError(LlmError);
  });

  it('message без частей output_text даёт text null', () => {
    const payload = messageWith([{ type: 'output_text', text: 42 }]);
    expect(parseResponsesResponse(payload)).toEqual({ text: null, toolCalls: [] });
  });
});

describe('responseFromEventStream', () => {
  it('берёт итоговый response из события response.completed', () => {
    const raw = [
      'event: response.created',
      'data: {"type":"response.created"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"output":' +
        '[{"type":"message","content":[{"type":"output_text","text":"Готово"}]}]}}'
    ].join('\n');
    expect(parseResponsesResponse(responseFromEventStream(raw))).toEqual({ text: 'Готово', toolCalls: [] });
  });

  it('работает без строк event, по полю type в данных', () => {
    const raw = 'data: {"type":"response.completed","response":{"output":[]}}\ndata: [DONE]';
    expect(responseFromEventStream(raw)).toEqual({ output: [] });
  });

  it('без response.completed возвращает undefined', () => {
    const raw = 'event: response.in_progress\ndata: {"type":"response.in_progress"}';
    expect(responseFromEventStream(raw)).toBeUndefined();
  });
});

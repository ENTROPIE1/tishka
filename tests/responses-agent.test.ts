import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../src/core/agent/agent';
import { createEventBus } from '../src/core/events';
import { createLlmClient } from '../src/core/llm/client';
import type { ToolDef, ToolRegistry, ToolResult } from '../src/core/types';

const echoTool: ToolDef = {
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

interface WireBody {
  instructions?: string;
  input: Array<Record<string, unknown>>;
  tools?: Array<{ type: string; name: string }>;
}

function readBody(init: RequestInit | undefined): WireBody {
  return JSON.parse(String(init?.body)) as WireBody;
}

function outputResponse(output: unknown[]): Response {
  return new Response(JSON.stringify({ output }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('агент через шлюз Responses', () => {
  it('вопрос → вызов инструмента → результат → ответ через reply', async () => {
    const urls: string[] = [];
    const bodies: WireBody[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      urls.push(String(input));
      bodies.push(readBody(init));
      if (bodies.length === 1) {
        return outputResponse([
          { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"раз"}' }
        ]);
      }
      return outputResponse([
        { type: 'message', content: [{ type: 'output_text', text: 'Считаю' }] },
        { type: 'function_call', call_id: 'c2', name: 'reply', arguments: '{"say":"Сделал"}' }
      ]);
    });
    const client = createLlmClient({
      baseUrl: 'https://gw.example.test/v1',
      getApiKey: async () => 'test-key',
      api: 'responses',
      fetch: fetchMock
    });
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const registry: ToolRegistry = {
      register: vi.fn(),
      unregisterSource: vi.fn(),
      list: () => [echoTool],
      call: async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
        calls.push({ name, args });
        return { ok: true, content: 'эхо: раз' };
      }
    };
    const agent = createAgent({
      llm: client,
      registry,
      events: createEventBus(),
      getModel: () => 'dks-local',
      now: () => new Date('2026-10-03T09:30:00')
    });

    const reply = await agent.handle('скажи раз');

    expect(reply).toEqual({ say: 'Сделал', mood: 'neutral' });
    expect(calls).toEqual([{ name: 'echo', args: { text: 'раз' } }]);
    expect(urls.every((url) => url === 'https://gw.example.test/v1/responses')).toBe(true);

    const first = bodies[0];
    expect(first.instructions).toBeTruthy();
    expect(first.tools?.every((tool) => tool.type === 'function')).toBe(true);
    expect(first.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'скажи раз' }] }]);

    const second = bodies[1];
    const kinds = second.input.map((item) => String(item['type'] ?? item['role'] ?? ''));
    expect(kinds).toEqual(['user', 'function_call', 'function_call_output']);
    const outputItem = second.input.find((item) => item['type'] === 'function_call_output');
    expect(outputItem).toEqual({ type: 'function_call_output', call_id: 'c1', output: 'эхо: раз' });
  });

  it('запрос с картинкой уходит в input_image', async () => {
    const bodies: WireBody[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(readBody(init));
      return outputResponse([{ type: 'message', content: [{ type: 'output_text', text: 'вижу ёжика' }] }]);
    });
    const client = createLlmClient({
      baseUrl: 'https://gw.example.test/v1',
      getApiKey: async () => 'test-key',
      api: 'responses',
      fetch: fetchMock
    });

    const response = await client.chat({
      model: 'vision',
      messages: [
        { role: 'system', content: 'Ты смотришь на снимок экрана' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'что на экране' },
            { type: 'image', dataUrl: 'data:image/png;base64,AAAA' }
          ]
        }
      ]
    });

    expect(response.text).toBe('вижу ёжика');
    const body = bodies[0];
    expect(body.instructions).toBe('Ты смотришь на снимок экрана');
    const content = body.input[0]['content'] as Array<Record<string, unknown>>;
    expect(content[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,AAAA' });
  });
});

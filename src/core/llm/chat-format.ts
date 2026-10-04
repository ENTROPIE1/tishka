import type { ToolDef } from '../types';
import type { ChatMessage, ChatRequest, ChatResponse, ContentPart } from './protocol';
import { LlmError } from './protocol';

export const UNEXPECTED_RESPONSE = 'Шлюз моделей вернул ответ неожиданного вида';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toWireContent(content: string | ContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return content;
  }
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: part.dataUrl } }
  );
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === 'assistant') {
    const wire: Record<string, unknown> = { role: 'assistant', content: message.content };
    if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
      wire.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) }
      }));
    }
    return wire;
  }
  return { role: message.role, content: toWireContent(message.content) };
}

function toWireTools(tools: ToolDef[] | undefined): Array<Record<string, unknown>> | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

export function chatWireBody(req: ChatRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: req.messages.map(toWireMessage),
    tools: toWireTools(req.tools),
    temperature: req.temperature
  };
}

function parseToolCall(value: unknown): ChatResponse['toolCalls'][number] {
  const source = isRecord(value) ? value : {};
  const fn = isRecord(source.function) ? source.function : {};
  const id = typeof source.id === 'string' ? source.id : '';
  const name = typeof fn.name === 'string' ? fn.name : '';
  let args: Record<string, unknown> = {};
  if (typeof fn.arguments === 'string' && fn.arguments.length > 0) {
    try {
      const parsed: unknown = JSON.parse(fn.arguments);
      if (isRecord(parsed)) {
        args = parsed;
      }
    } catch {
      args = {};
    }
  } else if (isRecord(fn.arguments)) {
    args = fn.arguments;
  }
  return { id, name, args };
}

export function parseResponse(payload: unknown): ChatResponse {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new LlmError('bad_response', UNEXPECTED_RESPONSE);
  }
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new LlmError('bad_response', UNEXPECTED_RESPONSE);
  }
  const message = first.message;
  const text = typeof message.content === 'string' ? message.content : null;
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawCalls.map(parseToolCall);
  return { text, toolCalls };
}

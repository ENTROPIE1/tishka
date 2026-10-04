import type { ChatMessage, ChatRequest, ChatResponse, ContentPart, ToolCall } from './protocol';
import { LlmError } from './protocol';
import { UNEXPECTED_RESPONSE, isRecord } from './chat-format';

export type ResponsesItem = Record<string, unknown>;

export interface ResponsesRequestBody {
  model: string;
  instructions?: string;
  input: ResponsesItem[];
  tools?: ResponsesItem[];
  tool_choice?: 'auto' | 'required' | 'none';
  temperature?: number;
  max_output_tokens?: number;
  store: false;
  stream: false;
}

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;

function systemInstructions(messages: ChatMessage[]): string | undefined {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role !== 'system') {
      continue;
    }
    const content = message.content;
    parts.push(
      typeof content === 'string'
        ? content
        : content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
    );
  }
  const joined = parts.join('\n\n');
  return joined === '' ? undefined : joined;
}

function userParts(content: string | ContentPart[]): ResponsesItem[] {
  if (typeof content === 'string') {
    return [{ type: 'input_text', text: content }];
  }
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'input_text', text: part.text }
      : { type: 'input_image', image_url: part.dataUrl }
  );
}

function assistantItems(message: AssistantMessage): ResponsesItem[] {
  const items: ResponsesItem[] = [];
  const text = message.content ?? '';
  if (text.trim() !== '') {
    items.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
  }
  for (const call of message.toolCalls ?? []) {
    items.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.args) });
  }
  return items;
}

function inputItems(messages: ChatMessage[]): ResponsesItem[] {
  const items: ResponsesItem[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }
    if (message.role === 'tool') {
      items.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
    } else if (message.role === 'assistant') {
      items.push(...assistantItems(message));
    } else {
      items.push({ role: 'user', content: userParts(message.content) });
    }
  }
  return items;
}

// Плоский вид: name, description, parameters прямо в элементе, без вложенного function.
function responsesTools(tools: ChatRequest['tools']): ResponsesItem[] | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  }));
}

export function toResponsesRequest(req: ChatRequest, opts: { maxTokens?: number } = {}): ResponsesRequestBody {
  const instructions = systemInstructions(req.messages);
  const tools = responsesTools(req.tools);
  return {
    model: req.model,
    input: inputItems(req.messages),
    store: false,
    stream: false,
    ...(instructions !== undefined ? { instructions } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(req.toolChoice !== undefined ? { tool_choice: req.toolChoice } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { max_output_tokens: opts.maxTokens } : {})
  };
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(raw) ? raw : {};
}

function functionCallItem(item: ResponsesItem): ToolCall {
  return {
    id: typeof item['call_id'] === 'string' ? item['call_id'] : '',
    name: typeof item['name'] === 'string' ? item['name'] : '',
    args: parseArguments(item['arguments'])
  };
}

function messageText(item: ResponsesItem): string {
  const parts = Array.isArray(item['content']) ? item['content'] : [];
  return parts
    .filter((part): part is ResponsesItem => isRecord(part) && part['type'] === 'output_text')
    .map((part) => (typeof part['text'] === 'string' ? part['text'] : ''))
    .join('');
}

export function parseResponsesResponse(payload: unknown): ChatResponse {
  if (!isRecord(payload) || !Array.isArray(payload['output']) || payload['output'].length === 0) {
    throw new LlmError('bad_response', UNEXPECTED_RESPONSE);
  }
  let text: string | null = null;
  const toolCalls: ToolCall[] = [];
  for (const item of payload['output']) {
    if (!isRecord(item)) {
      continue;
    }
    // reasoning и другие неизвестные элементы пропускаются.
    if (item['type'] === 'message') {
      const part = messageText(item);
      if (part !== '') {
        text = text === null ? part : text + part;
      }
    } else if (item['type'] === 'function_call') {
      toolCalls.push(functionCallItem(item));
    }
  }
  return { text, toolCalls };
}

// Шлюз иногда отвечает потоком событий даже при stream:false: читаем события
// до response.completed и берём итоговый объект response.
export function responseFromEventStream(raw: string): unknown {
  let event = '';
  let result: unknown;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }
    if (!line.startsWith('data:')) {
      continue;
    }
    const parsed = parseDataLine(line.slice('data:'.length).trim());
    if (parsed === undefined || !isRecord(parsed)) {
      continue;
    }
    const completed = event === 'response.completed' || parsed['type'] === 'response.completed';
    if (completed && isRecord(parsed['response'])) {
      result = parsed['response'];
    }
  }
  return result;
}

function parseDataLine(data: string): unknown {
  if (data === '' || data === '[DONE]') {
    return undefined;
  }
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

import type { ToolDef } from '../types';

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  toolChoice?: 'auto' | 'required' | 'none';   // учитывается только форматом responses
}

export interface ChatResponse {
  text: string | null;
  toolCalls: ToolCall[];
}

export type LlmApi = 'chat' | 'responses';

export type LlmErrorKind = 'auth' | 'limit' | 'network' | 'server' | 'bad_response';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

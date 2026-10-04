import type { ChatMessage } from '../llm/client';

export const MAX_HISTORY = 40;
export const MAX_CONTEXT_CHARS = 24_000;
export const LONG_MESSAGE_CHARS = 4000;
export const LONG_MESSAGE_KEEP = 300;
export const LONG_MESSAGE_MARK = '…[длинный текст сокращён, полный — в истории чата]';

function messageLength(message: ChatMessage): number {
  return typeof message.content === 'string' ? message.content.length : 0;
}

// Объём разговора без системного сообщения — то, что реально уходит в модель.
function contextVolume(history: ChatMessage[]): number {
  let total = 0;
  for (const message of history) {
    if (message.role !== 'system') {
      total += messageLength(message);
    }
  }
  return total;
}

// Убирает самую старую реплику; ответы инструментов уходят вместе со своим вызовом.
function removeOldest(history: ChatMessage[]): boolean {
  const index = history.findIndex((message) => message.role !== 'system');
  if (index < 0) {
    return false;
  }
  const [removed] = history.splice(index, 1);
  if (removed.role === 'assistant' && removed.toolCalls !== undefined && removed.toolCalls.length > 0) {
    const ids = new Set(removed.toolCalls.map((call) => call.id));
    while (index < history.length) {
      const next = history[index];
      if (next.role !== 'tool' || !ids.has(next.toolCallId)) {
        break;
      }
      ids.delete(next.toolCallId);
      history.splice(index, 1);
    }
  }
  return true;
}

export function trimHistory(history: ChatMessage[]): void {
  while (history.length > MAX_HISTORY || contextVolume(history) > MAX_CONTEXT_CHARS) {
    if (!removeOldest(history)) {
      return;
    }
  }
}

// Длинную реплику человека после ответа сокращаем в контексте; в ленте и в файле
// истории она остаётся целиком.
export function shortenUserMessage(history: ChatMessage[], message: ChatMessage): void {
  if (typeof message.content !== 'string' || message.content.length <= LONG_MESSAGE_CHARS) {
    return;
  }
  const index = history.indexOf(message);
  if (index < 0) {
    return;
  }
  history[index] = {
    role: 'user',
    content: message.content.slice(0, LONG_MESSAGE_KEEP) + LONG_MESSAGE_MARK
  };
  trimHistory(history);
}

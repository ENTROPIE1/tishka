import type { ChatMessage, ChatRequest, ChatResponse } from '../llm/client';
import { LlmError } from '../llm/client';
import { stepTools } from '../skills/tools';
import type { EventBus, Mood, Panel, Reply, ToolDef, ToolRegistry, ToolResult } from '../types';
import type { FyrLevel } from './persona';
import { buildSystemPrompt } from './prompt';
import { skillGuide } from './skill-guide';

export interface AgentDeps {
  llm: { chat(req: ChatRequest): Promise<ChatResponse> };
  registry: ToolRegistry;
  events: EventBus;
  getModel: () => string;
  getPersona?: () => { fyr: FyrLevel };
  now: () => Date;
}

export interface Agent {
  handle(userText: string): Promise<Reply>;
  history(): ChatMessage[];
  reset(): void;
}

const MAX_ROUNDS = 8;
const MAX_HISTORY = 40;
const MAX_TOOL_CONTENT = 6000;
const TRUNCATED_MARK = '\n[обрезано]';
const REPLY_TOOL_NAME = 'reply';

const panelSchema = {
  description: 'Панель с подробностями, ровно один из трёх видов',
  oneOf: [
    {
      type: 'object',
      description: 'Список',
      properties: {
        kind: { type: 'string', enum: ['list'] },
        title: { type: 'string', description: 'Заголовок списка' },
        items: {
          type: 'array',
          description: 'Элементы списка',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              subtitle: { type: 'string' },
              url: { type: 'string' }
            },
            required: ['title'],
            additionalProperties: false
          }
        }
      },
      required: ['kind', 'title', 'items'],
      additionalProperties: false
    },
    {
      type: 'object',
      description: 'Текст в markdown',
      properties: {
        kind: { type: 'string', enum: ['text'] },
        title: { type: 'string', description: 'Заголовок' },
        markdown: { type: 'string', description: 'Содержание в markdown' }
      },
      required: ['kind', 'title', 'markdown'],
      additionalProperties: false
    },
    {
      type: 'object',
      description: 'Картинка',
      properties: {
        kind: { type: 'string', enum: ['image'] },
        title: { type: 'string', description: 'Заголовок' },
        path: { type: 'string', description: 'Путь к файлу картинки' }
      },
      required: ['kind', 'title', 'path'],
      additionalProperties: false
    }
  ]
};

const replyTool: ToolDef = {
  name: REPLY_TOOL_NAME,
  description: 'Завершает работу и передаёт пользователю итоговый ответ.',
  inputSchema: {
    type: 'object',
    properties: {
      say: { type: 'string', description: 'Короткая фраза вслух' },
      show: panelSchema,
      mood: { type: 'string', enum: ['neutral', 'happy', 'confused'] }
    },
    required: ['say'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const ERROR_PHRASES: Record<LlmError['kind'], string> = {
  auth: 'Ключ шлюза моделей не подошёл, проверь настройки',
  limit: 'Шлюз моделей просит подождать, попробуй ещё раз чуть позже',
  network: 'Не получилось связаться со шлюзом моделей',
  server: 'Шлюз моделей сейчас недоступен',
  bad_response: 'Шлюз моделей ответил что-то непонятное'
};

function isReplyToolCall(name: string): boolean {
  return name === REPLY_TOOL_NAME;
}

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_CONTENT) {
    return text;
  }
  return text.slice(0, MAX_TOOL_CONTENT) + TRUNCATED_MARK;
}

function toolResultToText(result: ToolResult): string {
  if (result.ok) {
    return truncate(result.content);
  }
  const error = result.error ?? result.content;
  return truncate(error.length > 0 ? `Ошибка: ${error}` : 'Ошибка');
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]*[.!?…]+["»')\]]*\s*|[^.!?…]+$/g) ?? [];
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function replyFromText(text: string): Reply {
  const trimmed = text.trim();
  const sentences = splitSentences(trimmed);
  if (sentences.length <= 2) {
    return { say: trimmed, mood: 'neutral' };
  }
  const say = sentences.slice(0, 2).join(' ');
  return { say, show: { kind: 'text', title: 'Ответ', markdown: trimmed }, mood: 'neutral' };
}

function parseMood(value: unknown): Mood {
  return value === 'happy' || value === 'confused' || value === 'neutral' ? value : 'neutral';
}

function parsePanel(value: unknown): Panel | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const panel = value as Record<string, unknown>;
  if (panel.kind === 'text' && typeof panel.markdown === 'string') {
    return value as Panel;
  }
  if (panel.kind === 'image' && typeof panel.path === 'string') {
    return value as Panel;
  }
  if (panel.kind === 'list' && Array.isArray(panel.items)) {
    return value as Panel;
  }
  return undefined;
}

function replyFromToolArgs(args: Record<string, unknown>, fallbackText: string | null): Reply {
  const say = typeof args.say === 'string' && args.say.length > 0 ? args.say : (fallbackText ?? '').trim();
  const show = parsePanel(args.show);
  const mood = parseMood(args.mood);
  return show === undefined ? { say, mood } : { say, show, mood };
}

export function createAgent(deps: AgentDeps): Agent {
  const history: ChatMessage[] = [];

  function refreshSystemMessage(): void {
    const fyr = deps.getPersona?.().fyr ?? 'sometimes';
    const guide = skillGuide(stepTools(deps.registry));
    const system: ChatMessage = { role: 'system', content: buildSystemPrompt(deps.now(), fyr, guide) };
    if (history[0]?.role === 'system') {
      history[0] = system;
    } else {
      history.unshift(system);
    }
  }

  function trimHistory(): void {
    while (history.length > MAX_HISTORY) {
      const index = history.findIndex((message) => message.role !== 'system');
      if (index < 0) {
        return;
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
    }
  }

  function push(message: ChatMessage): void {
    history.push(message);
    trimHistory();
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      return await deps.registry.call(name, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, content: '', error: message };
    }
  }

  function toolsForModel(): ToolDef[] {
    return [...deps.registry.list().filter((def) => def.name !== REPLY_TOOL_NAME), replyTool];
  }

  function finish(reply: Reply): Reply {
    deps.events.emit({ type: 'reply', reply });
    return reply;
  }

  async function handle(userText: string): Promise<Reply> {
    refreshSystemMessage();
    push({ role: 'user', content: userText });

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      deps.events.emit({ type: 'think.start' });

      let response: ChatResponse;
      try {
        response = await deps.llm.chat({
          model: deps.getModel(),
          messages: [...history],
          tools: toolsForModel()
        });
      } catch (error) {
        const phrase =
          error instanceof LlmError ? ERROR_PHRASES[error.kind] : 'Что-то пошло не так, попробуй ещё раз';
        const message = error instanceof Error ? error.message : String(error);
        deps.events.emit({ type: 'error', message });
        return finish({ say: phrase, mood: 'confused' });
      }

      const calls = response.toolCalls;
      if (calls.length === 0) {
        const text = response.text ?? '';
        push({ role: 'assistant', content: text });
        return finish(replyFromText(text));
      }

      push({ role: 'assistant', content: response.text, toolCalls: calls });

      let finalReply: Reply | null = null;
      for (const call of calls) {
        if (isReplyToolCall(call.name)) {
          finalReply = replyFromToolArgs(call.args, response.text);
          push({ role: 'tool', toolCallId: call.id, content: 'Ответ передан пользователю' });
          continue;
        }
        const result = await callTool(call.name, call.args);
        push({ role: 'tool', toolCallId: call.id, content: toolResultToText(result) });
      }
      if (finalReply !== null) {
        return finish(finalReply);
      }
    }

    return finish({ say: 'Не получилось, слишком много шагов', mood: 'confused' });
  }

  return {
    handle,
    history(): ChatMessage[] {
      return [...history];
    },
    reset(): void {
      history.length = 0;
    }
  };
}

import type { ChatMessage, ChatRequest, ChatResponse } from '../llm/client';
import { LlmError } from '../llm/client';
import { stepTools } from '../skills/tools';
import type { EventBus, Reply, ToolDef, ToolRegistry, ToolResult } from '../types';
import type { FyrLevel } from './persona';
import { buildSystemPrompt } from './prompt';
import { REPLY_TOOL_NAME, replyFromText, replyFromToolArgs, replyTool } from './reply';
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

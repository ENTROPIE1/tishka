import type { ChatMessage, ChatRequest, ChatResponse } from '../llm/client';
import { LlmError } from '../llm/client';
import { isCancelled, withCancel } from '../cancel';
import { memoryBlock, type MemoryLine } from '../memory/prompt';
import { stepTools } from '../skills/tools';
import type { EventBus, InputSource, Reply, SpeechMode, ToolDef, ToolRegistry, ToolResult } from '../types';
import { shortenUserMessage, trimHistory } from './context';
import type { FyrLevel } from './persona';
import { buildSystemPrompt } from './prompt';
import { REPLY_TOOL_NAME, replyFromText, replyFromToolArgs, replyTool } from './reply';
import { skillGuide } from './skill-guide';
import type { TimingMark } from '../../main/timing-log';

export interface AgentDeps {
  llm: { chat(req: ChatRequest): Promise<ChatResponse> };
  registry: ToolRegistry;
  events: EventBus;
  getModel: () => string;
  getPersona?: () => { fyr: FyrLevel };
  getSpeechMode?: () => SpeechMode;
  memory?: { search(query: string, limit?: number): MemoryLine[] };
  situation?: () => string;
  now: () => Date;
  mark?: TimingMark;
}

export interface Agent {
  handle(userText: string, opts?: { signal?: AbortSignal; source?: InputSource }): Promise<Reply>;
  history(): ChatMessage[];
  reset(): void;
}

const MAX_ROUNDS = 8;
const MAX_TOOL_CONTENT = 6000;
const TRUNCATED_MARK = '\n[обрезано]';

const SETTINGS_HINT = 'Смените модель в «Подключениях»';
const GATEWAY_DOWN = 'Шлюз недоступен. Проверьте адрес в «Подключениях»';

// Человеку достаётся понятная причина без тела ответа шлюза: имя модели и
// вид отказа. Идентификатор ключа и почта из тела сюда не попадают.
function errorToHuman(kind: LlmError['kind'] | undefined, budget: boolean, model: string): {
  feed: string;
  say: string;
} {
  if (budget) {
    return {
      feed: `На модель ${model} сегодня исчерпан лимит. ${SETTINGS_HINT}`,
      say: 'На эту модель сегодня исчерпан лимит, смени её в подключениях'
    };
  }
  switch (kind) {
    case 'server':
      return {
        feed: `Модель ${model} не отвечает (ошибка сервера). ${SETTINGS_HINT}`,
        say: 'Модель не отвечает, смени её в подключениях'
      };
    case 'network':
      return { feed: GATEWAY_DOWN, say: 'Шлюз недоступен, проверь настройки' };
    case 'auth':
      return {
        feed: 'Ключ шлюза моделей не подошёл, проверь настройки',
        say: 'Ключ шлюза не подошёл, проверь настройки'
      };
    case 'limit':
      return {
        feed: 'Шлюз моделей просит подождать, попробуйте позже',
        say: 'Подожди немного и попробуй снова'
      };
    default:
      return {
        feed: 'Шлюз моделей ответил что-то непонятное',
        say: 'Не получилось получить ответ, попробуй ещё раз'
      };
  }
}

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
  let rounds = 0;

  function refreshSystemMessage(userText: string, source: InputSource): void {
    const fyr = deps.getPersona?.().fyr ?? 'sometimes';
    const guide = skillGuide(stepTools(deps.registry));
    const block = memoryBlock(deps.memory?.search(userText, 8) ?? []);
    const system: ChatMessage = {
      role: 'system',
      content: buildSystemPrompt(
        deps.now(),
        fyr,
        guide,
        block,
        {
          speechMode: deps.getSpeechMode?.() ?? 'text',
          userSource: source
        },
        deps.situation?.()
      )
    };
    if (history[0]?.role === 'system') {
      history[0] = system;
    } else {
      history.unshift(system);
    }
  }

  function push(message: ChatMessage): void {
    history.push(message);
    trimHistory(history);
  }

  async function callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    try {
      return await withCancel(deps.registry.call(name, args), signal);
    } catch (error) {
      if (isCancelled(error, signal)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, content: '', error: message };
    }
  }

  function toolsForModel(): ToolDef[] {
    return [...deps.registry.list().filter((def) => def.name !== REPLY_TOOL_NAME), replyTool];
  }

  function isSkillTool(name: string): boolean {
    return deps.registry.list().some((def) => def.name === name && def.source === 'skill');
  }

  function finish(reply: Reply): Reply {
    deps.events.emit({ type: 'reply', reply });
    return reply;
  }

  // Оборванный ход не должен остаться в контексте: запрос к модели отвергается,
  // если за вызовом инструмента не следует его результат.
  function dropIncompleteTurn(): void {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (message.role === 'tool') {
        continue;
      }
      if (message.role === 'assistant' && message.toolCalls !== undefined) {
        if (history.length - index - 1 < message.toolCalls.length) {
          history.splice(index);
        }
      }
      return;
    }
  }

  async function handle(userText: string, opts?: { signal?: AbortSignal; source?: InputSource }): Promise<Reply> {
    const signal = opts?.signal;
    refreshSystemMessage(userText, opts?.source ?? 'text');
    const userMessage: ChatMessage = { role: 'user', content: userText };
    push(userMessage);
    rounds = 0;
    const startedAt = Date.now();
    deps.mark?.('model.request.start');
    try {
      const reply = await respond(signal);
      deps.mark?.('model.request.end', { ms: Date.now() - startedAt, steps: rounds });
      shortenUserMessage(history, userMessage);
      return reply;
    } catch (error) {
      if (isCancelled(error, signal)) {
        dropIncompleteTurn();
      }
      throw error;
    }
  }

  async function respond(signal?: AbortSignal): Promise<Reply> {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      rounds = round + 1;
      deps.events.emit({ type: 'think.start' });

      let response: ChatResponse;
      try {
        response = await deps.llm.chat({
          model: deps.getModel(),
          messages: [...history],
          tools: toolsForModel(),
          signal
        });
      } catch (error) {
        if (isCancelled(error, signal)) {
          throw error;
        }
        const kind = error instanceof LlmError ? error.kind : undefined;
        const budget = error instanceof LlmError && error.budget;
        const human = errorToHuman(kind, budget, deps.getModel());
        deps.events.emit({ type: 'error', message: human.feed });
        return finish({ say: human.say, mood: 'confused' });
      }

      const calls = response.toolCalls;
      if (calls.length === 0) {
        const text = response.text ?? '';
        if (text.trim().length === 0) {
          return finish(replyFromText(text));
        }
        push({ role: 'assistant', content: text });
        return finish(replyFromText(text));
      }

      push({ role: 'assistant', content: response.text, toolCalls: calls });

      let finalReply: Reply | null = null;
      let toolReply: Reply | null = null;
      // Прямой ответ инструмента достаётся человеку, только когда вызов
      // единственный в этом шаге и пришёл не из навыка: иначе результат
      // нужен основной модели, чтобы доделать составную просьбу.
      const singleCall = calls.length === 1;
      for (const call of calls) {
        if (isReplyToolCall(call.name)) {
          finalReply = replyFromToolArgs(call.args, response.text);
          push({ role: 'tool', toolCallId: call.id, content: 'Ответ передан пользователю' });
          continue;
        }
        const result = await callTool(call.name, call.args, signal);
        push({ role: 'tool', toolCallId: call.id, content: toolResultToText(result) });
        if (singleCall && !isSkillTool(call.name) && result.ok && result.reply !== undefined) {
          toolReply = result.reply;
        }
      }
      if (finalReply !== null) {
        return finish(finalReply);
      }
      if (toolReply !== null) {
        return finish(toolReply);
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

import type { EventBus, Panel, Reply, Skill, ToolRegistry } from '../types';
import { CancelledError, isCancelled, withCancel } from '../cancel';
import { renderTemplate, type TemplateContext, type TemplateStepResult } from './template';

export interface RunResult {
  ok: boolean;
  reply?: Reply;
  steps: Record<string, TemplateStepResult>;
  failedStep?: string;
  error?: string;
}

export interface SkillRunnerDeps {
  registry: ToolRegistry;
  ask(prompt: string): Promise<string>;
  events: EventBus;
  now: () => Date;
}

export interface SkillRunOptions {
  background?: boolean;          // true — вызовы инструментов идут без tool.start и tool.end
  signal?: AbortSignal;          // отмена хода человеком
}

export interface SkillRunner {
  run(skill: Skill, inputs?: Record<string, unknown>, opts?: SkillRunOptions): Promise<RunResult>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function withData(result: TemplateStepResult): TemplateStepResult {
  return result.data === undefined ? { content: result.content } : result;
}

function resolveInputs(
  skill: Skill,
  inputs: Record<string, unknown> | undefined
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const values: Record<string, unknown> = { ...(inputs ?? {}) };

  for (const input of skill.inputs ?? []) {
    if (values[input.name] !== undefined) {
      continue;
    }
    if (input.default !== undefined) {
      values[input.name] = input.default;
      continue;
    }
    if (input.required) {
      return { ok: false, error: `Не указан обязательный вход: ${input.name}` };
    }
  }

  return { ok: true, values };
}

export function createSkillRunner(deps: SkillRunnerDeps): SkillRunner {
  function fail(failedStep: string, error: string, steps: Record<string, TemplateStepResult>): RunResult {
    deps.events.emit({ type: 'error', message: error });
    return { ok: false, failedStep, error, steps };
  }

  async function run(
    skill: Skill,
    inputs?: Record<string, unknown>,
    opts?: SkillRunOptions
  ): Promise<RunResult> {
    const resolved = resolveInputs(skill, inputs);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, steps: {} };
    }

    const steps: Record<string, TemplateStepResult> = {};
    let lastReply: Reply | undefined;
    const signal = opts?.signal;

    for (const step of skill.steps) {
      if (signal?.aborted) {
        throw new CancelledError();
      }
      const ctx: TemplateContext = { inputs: resolved.values, steps, now: deps.now() };

      try {
        if ('tool' in step) {
          const args = renderTemplate(step.args, ctx) as Record<string, unknown>;
          const background = opts?.background === true;
          const result = await withCancel(
            background
              ? deps.registry.call(step.tool, args, { background: true })
              : deps.registry.call(step.tool, args),
            signal
          );
          if (!result.ok) {
            return fail(step.id, result.error ?? result.content, steps);
          }
          steps[step.id] = withData({ content: result.content, data: result.data });
        } else if ('ask' in step) {
          const prompt = textOf(renderTemplate(step.ask, ctx));
          const answer = await withCancel(deps.ask(prompt), signal);
          steps[step.id] = { content: answer };
        } else {
          const say = textOf(renderTemplate(step.say, ctx));
          const show = step.show === undefined ? undefined : (renderTemplate(step.show, ctx) as Panel);
          const reply: Reply = show === undefined ? { say } : { say, show };
          deps.events.emit({ type: 'reply', reply });
          steps[step.id] = { content: say };
          lastReply = reply;
        }
      } catch (error) {
        if (isCancelled(error, signal)) {
          throw error;
        }
        return fail(step.id, errorMessage(error), steps);
      }
    }

    return { ok: true, reply: lastReply ?? { say: 'Готово!' }, steps };
  }

  return { run };
}

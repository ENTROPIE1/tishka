import { createAgent } from '../src/core/agent/agent';
import type { FyrLevel } from '../src/core/agent/persona';
import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import { createLlmClient, LlmError } from '../src/core/llm/client';
import { registerBuiltinTools } from '../src/core/tools/builtin';
import { createToolRegistry } from '../src/core/tools/registry';

const config = defaultConfig();
const model = process.argv[2] ?? config.llm.model;

function fyrFromArg(value: string | undefined): FyrLevel {
  return value === 'off' || value === 'often' ? value : 'sometimes';
}

const fyr = fyrFromArg(process.argv[3]);

const events = createEventBus();
const registry = createToolRegistry(events);
registerBuiltinTools(registry, {
  openExternal: async () => undefined,
  showPanel: () => undefined,
  now: () => new Date()
});

const client = createLlmClient({
  baseUrl: config.llm.baseUrl,
  getApiKey: async () => process.env.DKS_API_KEY
});

const agent = createAgent({
  llm: client,
  registry,
  events,
  getModel: () => model,
  getPersona: () => ({ fyr }),
  now: () => new Date()
});

const PHRASES = [
  'Привет!',
  'Открой https://example.org',
  'Расскажи, что такое нагрузочное тестирование',
  'Назови пять дней недели списком',
  'Который час?',
  'Расскажи, что такое вики'
];

async function main(): Promise<void> {
  console.log(`Модель: ${model}, фыр: ${fyr}`);
  for (let index = 0; index < PHRASES.length; index += 1) {
    const phrase = PHRASES[index];
    agent.reset();
    const reply = await agent.handle(phrase);
    const panel = reply.show === undefined ? 'нет' : `${reply.show.kind} «${reply.show.title}»`;
    console.log(`${index + 1}. «${phrase}»`);
    console.log(`   say (${reply.say.length}): ${reply.say}`);
    console.log(`   панель: ${panel}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof LlmError) {
    console.error(`Ошибка (${error.kind}): ${error.message}`);
  } else {
    console.error('Непредвиденная ошибка');
  }
  process.exitCode = 1;
});

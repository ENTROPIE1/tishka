import { createAgent } from '../src/core/agent/agent';
import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import { createLlmClient, LlmError } from '../src/core/llm/client';
import { registerBuiltinTools } from '../src/core/tools/builtin';
import { createToolRegistry } from '../src/core/tools/registry';

const config = defaultConfig();
const model = process.argv[2] ?? config.llm.model;

const ASK_PHRASE = 'Отформатируй по шаблону итог недели';
const NOTES = [
  'Заметки за неделю:',
  '- закрыл задачу по отчёту;',
  '- согласовал план на следующий спринт;',
  '- провёл две встречи с заказчиком.'
].join('\n');

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
  getPersona: () => config.persona,
  now: () => new Date()
});

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  console.log(`Модель: ${model}`);

  const first = await agent.handle(ASK_PHRASE);
  console.log(`1. «${ASK_PHRASE}»`);
  console.log(`   say: ${first.say}`);
  if (first.ask === undefined) {
    fail('Ожидалась просьба ask в ответе на первую фразу');
  } else {
    console.log(`   ask: ${first.ask.title}`);
  }

  const second = await agent.handle(NOTES);
  console.log('2. отправлены заметки');
  console.log(`   say: ${second.say}`);
  if (second.show === undefined || second.show.kind !== 'text') {
    fail('Ожидалась карточка show вида text после заметок');
    return;
  }
  console.log(`   show: «${second.show.title}»`);
  console.log(second.show.markdown);
  if (/вот ваш/i.test(second.show.markdown)) {
    fail('В markdown попала вступительная фраза');
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

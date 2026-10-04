import { createAgent } from '../src/core/agent/agent';
import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import { createLlmClient, LlmError } from '../src/core/llm/client';
import { registerBuiltinTools } from '../src/core/tools/builtin';
import { createToolRegistry } from '../src/core/tools/registry';
import { registerWebTools } from '../src/core/tools/web';
import type { Reply } from '../src/core/types';

const config = defaultConfig();
const model = process.argv[2] ?? config.llm.model;
const PHRASE = 'Найди в Википедии, сколько иголок у ежа';

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function hasSourceLink(reply: Reply): boolean {
  if (reply.show === undefined) {
    return false;
  }
  if (reply.show.kind === 'list') {
    return reply.show.items.some((item) => item.url !== undefined && item.url.includes('wikipedia.org'));
  }
  if (reply.show.kind === 'text') {
    return reply.show.markdown.includes('wikipedia.org');
  }
  return false;
}

async function main(): Promise<void> {
  const events = createEventBus();
  const used: string[] = [];
  events.on((event) => {
    if (event.type === 'tool.start') {
      used.push(event.tool);
    }
  });

  const registry = createToolRegistry(events);
  registerBuiltinTools(registry, {
    openExternal: async () => undefined,
    showPanel: () => undefined,
    now: () => new Date()
  });
  registerWebTools(registry, { fetch: globalThis.fetch }, true);

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

  console.log(`Модель: ${model}`);
  console.log(`Фраза: «${PHRASE}»`);
  const reply = await agent.handle(PHRASE);
  console.log(`say: ${reply.say}`);
  console.log(`show: ${reply.show?.kind ?? '—'}`);
  console.log(`Инструменты: ${used.join(', ') || '—'}`);

  if (!used.includes('wiki_search') && !used.includes('wiki_read')) {
    fail('Ожидался вызов wiki_search или wiki_read');
  }
  if (!hasSourceLink(reply)) {
    fail('В ответе нет карточки со ссылкой на статью');
  }
}

main().catch((error: unknown) => {
  if (error instanceof LlmError) {
    console.error(`Ошибка (${error.kind}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : 'Непредвиденная ошибка');
  }
  process.exitCode = 1;
});

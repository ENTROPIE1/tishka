import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../src/core/agent/agent';
import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import { createLlmClient, LlmError, type ChatRequest, type ChatResponse } from '../src/core/llm/client';
import { createSkillStore } from '../src/core/skills/store';
import { registerSkillTools } from '../src/core/skills/tools';
import { registerBuiltinTools } from '../src/core/tools/builtin';
import { createToolRegistry } from '../src/core/tools/registry';
import type { ToolDef } from '../src/core/types';

const config = defaultConfig();
const model = process.argv[2] ?? config.llm.model;

// Подставной инструмент вместо настоящего MCP-сервера конфлюенса.
const getPageVersion: ToolDef = {
  name: 'confluence__get_page_version',
  description: 'Возвращает страницу конфлюенса и номер её текущей версии.',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: { type: 'number', description: 'Номер страницы' }
    },
    required: ['page_id'],
    additionalProperties: false
  },
  source: 'mcp:confluence',
  readOnly: true
};

const REPLICA = [
  'Научись следить за страницей в конфлюенсе',
  'Страница 123456, проверяй каждые две минуты',
  'Да, сохраняй'
];

async function main(): Promise<void> {
  if (process.env.DKS_API_KEY === undefined || process.env.DKS_API_KEY === '') {
    console.error('Задай переменную окружения DKS_API_KEY');
    process.exitCode = 1;
    return;
  }

  const events = createEventBus();
  const registry = createToolRegistry(events);
  registerBuiltinTools(registry, {
    openExternal: async () => undefined,
    showPanel: () => undefined,
    now: () => new Date()
  });
  registry.register(getPageVersion, async (args) => ({
    ok: true,
    content: `Страница ${String(args.page_id)}, версия 7`,
    data: { version: 7 }
  }));

  const skillsDir = await mkdtemp(join(tmpdir(), 'tishka-wizard-'));
  const store = createSkillStore(skillsDir);
  registerSkillTools(registry, { store, registry, events });

  const client = createLlmClient({
    baseUrl: config.llm.baseUrl,
    getApiKey: async () => process.env.DKS_API_KEY
  });
  // Обёртка запоминает, каким путём модель ответила в последнем ходе.
  let answeredViaReply = false;
  const llm = {
    chat: async (req: ChatRequest): Promise<ChatResponse> => {
      const response = await client.chat(req);
      answeredViaReply = response.toolCalls.some((call) => call.name === 'reply');
      return response;
    }
  };
  const agent = createAgent({
    llm,
    registry,
    events,
    getModel: () => model,
    now: () => new Date()
  });

  let saveSkillCalls = 0;
  events.on((event) => {
    if (event.type === 'tool.start' && event.tool === 'save_skill') {
      saveSkillCalls += 1;
    }
  });

  console.log(`Модель: ${model}`);
  console.log(`Хранилище навыков: ${skillsDir}`);
  let savedOnReplica: number | undefined;
  for (let index = 0; index < REPLICA.length; index += 1) {
    const phrase = REPLICA[index];
    const callsBefore = saveSkillCalls;
    const reply = await agent.handle(phrase);
    const panel = reply.show === undefined ? 'нет' : `${reply.show.kind} «${reply.show.title}»`;
    console.log(`${index + 1}. «${phrase}»`);
    console.log(`   say: ${reply.say}`);
    console.log(`   путь: ${answeredViaReply ? 'вызов reply' : 'обычный текст'}`);
    console.log(`   панель: ${panel}`);
    if (savedOnReplica === undefined && saveSkillCalls > callsBefore) {
      savedOnReplica = index + 1;
    }
  }

  if (savedOnReplica === undefined) {
    console.log('save_skill за диалог не вызывался');
  } else {
    console.log(`save_skill вызван после реплики пользователя №${savedOnReplica}`);
  }

  const skills = await store.list();
  if (skills.length === 0) {
    console.log('Навыков не сохранилось');
    process.exitCode = 1;
    return;
  }
  console.log('Сохранённые навыки:');
  for (const skill of skills) {
    console.log(JSON.stringify(skill, null, 2));
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

import { defaultConfig } from '../src/core/config';
import { createLlmClient, LlmError } from '../src/core/llm/client';
import type { ToolDef } from '../src/core/types';

const config = defaultConfig();
const model = process.argv[2] ?? config.llm.model;

const getTime: ToolDef = {
  name: 'get_time',
  description: 'Возвращает текущее время',
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'Город, для которого нужно время' }
    }
  },
  source: 'builtin',
  readOnly: true
};

const client = createLlmClient({
  baseUrl: config.llm.baseUrl,
  getApiKey: async () => process.env.DKS_API_KEY
});

async function main(): Promise<void> {
  const response = await client.chat({
    model,
    messages: [{ role: 'user', content: 'Сколько сейчас времени в Москве?' }],
    tools: [getTime]
  });

  if (response.toolCalls.length === 0) {
    console.log(`Модель ${model} не вызвала инструмент. Ответ: ${response.text ?? '(пусто)'}`);
    return;
  }

  for (const call of response.toolCalls) {
    console.log(`Модель ${model} вызвала инструмент ${call.name} с аргументами ${JSON.stringify(call.args)}`);
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

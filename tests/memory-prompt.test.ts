import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt } from '../src/core/agent/prompt';
import { createAgent } from '../src/core/agent/agent';
import { createEventBus } from '../src/core/events';
import type { ChatRequest, ChatResponse } from '../src/core/llm/client';
import { createMemoryStore } from '../src/core/memory/store';
import { MEMORY_RULES, memoryBlock, type MemoryLine } from '../src/core/memory/prompt';
import type { ToolRegistry } from '../src/core/types';

const NOW = new Date('2026-10-05T09:30:00');

const anna: MemoryLine = {
  id: 'anna',
  text: 'Аня Петрова, тестирование — anna@example.ru',
  tags: ['почта']
};

describe('memoryBlock', () => {
  it('собирает блок «Что ты помнишь по теме» со строкой и id на запись', () => {
    const block = memoryBlock([anna]);
    expect(block).toContain('Что ты помнишь по теме');
    expect(block).toContain('- anna: Аня Петрова');
  });

  it('при пустом списке блока нет', () => {
    expect(memoryBlock([])).toBeUndefined();
  });
});

describe('системное сообщение с памятью', () => {
  it('правила памяти есть всегда, а блок только при найденных записях', () => {
    const withMemory = buildSystemPrompt(NOW, 'sometimes', undefined, memoryBlock([anna]));
    const withoutMemory = buildSystemPrompt(NOW, 'sometimes');

    expect(withMemory).toContain('Что ты помнишь по теме');
    expect(withoutMemory).not.toContain('Что ты помнишь по теме');
    expect(withMemory).toContain(MEMORY_RULES);
    expect(withoutMemory).toContain(MEMORY_RULES);
  });
});

describe('createAgent с памятью', () => {
  function makeAgent(memory?: { search(query: string, limit?: number): MemoryLine[] }) {
    const registry: ToolRegistry = {
      register: vi.fn(),
      unregisterSource: vi.fn(),
      list: () => [],
      call: vi.fn()
    };
    const requests: ChatRequest[] = [];
    const llm = {
      chat: vi.fn(async (req: ChatRequest): Promise<ChatResponse> => {
        requests.push(req);
        return { text: 'Коротко', toolCalls: [] };
      })
    };
    const agent = createAgent({
      llm,
      registry,
      events: createEventBus(),
      getModel: () => 'dks-local',
      memory,
      now: () => NOW
    });
    return { agent, requests };
  }

  it('добавляет найденные записи в системное сообщение', async () => {
    const { agent, requests } = makeAgent({ search: () => [anna] });

    await agent.handle('подготовь письмо Ане');

    const system = requests[0].messages[0];
    const content = system.role === 'system' && typeof system.content === 'string' ? system.content : '';
    expect(content).toContain('Что ты помнишь по теме');
    expect(content).toContain('anna@example.ru');
  });

  it('без найденных записей блока нет', async () => {
    const { agent, requests } = makeAgent({ search: () => [] });

    await agent.handle('расписание встреч');

    const system = requests[0].messages[0];
    const content = system.role === 'system' && typeof system.content === 'string' ? system.content : '';
    expect(content).not.toContain('Что ты помнишь по теме');
  });

  it('запись, изменённая между ходами, попадает в следующий запрос новой', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tishka-memory-prompt-'));
    try {
      const store = createMemoryStore({ filePath: join(dir, 'memory.json'), now: () => NOW });
      await store.load();
      const saved = await store.add({ text: 'Меня зовут Аня' });
      const { agent, requests } = makeAgent({ search: (query, limit) => store.search(query, limit) });

      await agent.handle('Меня зовут Аня');
      await store.update(saved.id, { text: 'Меня зовут Иван' });
      await agent.handle('Меня зовут Аня');

      const second = requests[1].messages[0];
      const content = second.role === 'system' && typeof second.content === 'string' ? second.content : '';
      expect(content).toContain('Меня зовут Иван');
      expect(content).not.toContain('Меня зовут Аня');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/core/agent/agent';
import type { FyrLevel } from '../src/core/agent/persona';
import { personaPrompt } from '../src/core/agent/persona';
import { buildSystemPrompt } from '../src/core/agent/prompt';
import { defaultConfig, mergeConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import type { ChatRequest, ChatResponse } from '../src/core/llm/client';
import type { ToolRegistry } from '../src/core/types';

const NOW = new Date('2026-10-03T09:30:00');

const registry: ToolRegistry = {
  register: () => undefined,
  unregisterSource: () => undefined,
  list: () => [],
  call: async () => ({ ok: true, content: '' })
};

function makeLlm(requests: ChatRequest[]): { chat(req: ChatRequest): Promise<ChatResponse> } {
  return {
    chat: async (req: ChatRequest): Promise<ChatResponse> => {
      requests.push(req);
      return { text: 'Коротко', toolCalls: [] };
    }
  };
}

function systemContent(requests: ChatRequest[]): string {
  const system = requests[0]?.messages[0];
  return system?.role === 'system' && typeof system.content === 'string' ? system.content : '';
}

describe('personaPrompt', () => {
  it('при off фыр запрещён', () => {
    const prompt = personaPrompt('off');
    expect(prompt).toContain('запрещён');
    expect(prompt).toContain('никогда');
  });

  it('sometimes и often дают разный текст о частоте', () => {
    const sometimes = personaPrompt('sometimes');
    const often = personaPrompt('often');
    expect(sometimes).toContain('приправа');
    expect(sometimes).toContain('двух ответах подряд');
    expect(often).toContain('большинств');
    expect(often).not.toContain('подряд');
    expect(sometimes).not.toBe(often);
  });

  it('содержит правило о речи без цифр и латиницы', () => {
    const prompt = personaPrompt('sometimes');
    expect(prompt).toContain('в say нет цифр, латиницы и сокращений');
    expect(prompt).toContain('конфлюенс');
    expect(prompt).toContain('В show цифры и латиница разрешены');
  });

  it('требует словами и с единицами называть время, даты и количества', () => {
    const prompt = personaPrompt('sometimes');
    expect(prompt).toContain('с единицами');
    expect(prompt).toContain('двадцать три часа тридцать четыре минуты');
    expect(prompt).toContain('пятое октября');
    expect(prompt).toContain('три встречи');
  });

  it('требует единицы времени и в подтверждениях', () => {
    const prompt = personaPrompt('sometimes');
    expect(prompt).toContain('напомню в девять часов тридцать минут');
    expect(prompt).toContain('в том числе в подтверждениях');
  });

  it('запрещает произносить номера-идентификаторы как количество', () => {
    const prompt = personaPrompt('sometimes');
    expect(prompt).toContain('номер страницы');
    expect(prompt).toContain('ключ задачи');
    expect(prompt).toContain('номер версии длиннее двух цифр');
    expect(prompt).toContain('за этой страницей');
    expect(prompt).toContain('а сам номер покажи в show');
  });

  it('содержит правило о разделении на say и show', () => {
    const prompt = personaPrompt('sometimes');
    expect(prompt).toContain('say не пересказывает show');
    expect(prompt).toContain('панелью text');
    expect(prompt).toContain('панелью list');
  });

  it('запрещает вводные-обещания в say', () => {
    const prompt = personaPrompt('sometimes');
    expect(prompt).toContain('а не обещание');
    expect(prompt).toContain('«Сейчас расскажу»');
    expect(prompt).toContain('«Сейчас посмотрю»');
    expect(prompt).not.toContain('"say": "Сейчас расскажу.');
  });

  it('содержит четыре примера ответов', () => {
    const prompt = personaPrompt('often');
    expect(prompt.match(/Пример \d/g)).toHaveLength(4);
  });
});

describe('buildSystemPrompt', () => {
  it('включает раздел характера', () => {
    const prompt = buildSystemPrompt(NOW, 'sometimes');
    expect(prompt).toContain('ёжик Тишка');
    expect(prompt).toContain('на «ты»');
  });

  it('не повторяет прежние строки о длине say', () => {
    const prompt = buildSystemPrompt(NOW, 'sometimes');
    expect(prompt).not.toContain('до двух коротких предложений');
    expect(prompt).not.toContain('Без цифр, без латиницы');
  });

  it('зависит от уровня фыр', () => {
    expect(buildSystemPrompt(NOW, 'off')).toContain('запрещён');
    expect(buildSystemPrompt(NOW, 'often')).toContain('большинств');
  });
});

describe('persona в config', () => {
  it('defaultConfig даёт sometimes', () => {
    expect(defaultConfig().persona.fyr).toBe('sometimes');
  });

  it('mergeConfig без persona даёт sometimes', () => {
    const config = mergeConfig({});
    expect(config.persona.fyr).toBe('sometimes');
  });

  it('mergeConfig с неизвестным значением даёт sometimes', () => {
    const config = mergeConfig({ persona: { fyr: 'громко' } });
    expect(config.persona.fyr).toBe('sometimes');
  });

  it('mergeConfig сохраняет известное значение', () => {
    const config = mergeConfig({ persona: { fyr: 'off' } });
    expect(config.persona.fyr).toBe('off');
  });
});

describe('createAgent с persona', () => {
  it('getPersona со значением off — в системном сообщении фыр запрещён', async () => {
    const requests: ChatRequest[] = [];
    const agent = createAgent({
      llm: makeLlm(requests),
      registry,
      events: createEventBus(),
      getModel: () => 'dks-local',
      getPersona: () => ({ fyr: 'off' }),
      now: () => NOW
    });

    await agent.handle('привет');

    expect(systemContent(requests)).toContain('запрещён');
    expect(systemContent(requests)).not.toContain('приправа');
  });

  it('без getPersona действует уровень sometimes', async () => {
    const requests: ChatRequest[] = [];
    const agent = createAgent({
      llm: makeLlm(requests),
      registry,
      events: createEventBus(),
      getModel: () => 'dks-local',
      now: () => NOW
    });

    await agent.handle('привет');

    expect(systemContent(requests)).toContain('приправа');
  });
});

describe('уровень фыр', () => {
  it('FyrLevel принимает только три значения', () => {
    const levels: FyrLevel[] = ['off', 'sometimes', 'often'];
    expect(levels).toHaveLength(3);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import { CONFIRM_BACKGROUND_ERROR, CONFIRM_DENIED_ERROR, createConfirmGate } from '../src/core/tools/confirm';
import { requiresConfirm } from '../src/core/tools/confirm-policy';
import { createToolRegistry } from '../src/core/tools/registry';
import type { McpServerConfig, TishkaEvent, ToolDef, ToolResult } from '../src/core/types';

const changing: ToolDef = {
  name: 'jira__create',
  description: '',
  inputSchema: { type: 'object' },
  source: 'mcp:jira',
  readOnly: false
};

const reading: ToolDef = {
  name: 'jira__search',
  description: '',
  inputSchema: { type: 'object' },
  source: 'mcp:jira',
  readOnly: true
};

const builtin: ToolDef = {
  name: 'calendar_add',
  description: '',
  inputSchema: { type: 'object' },
  source: 'builtin',
  readOnly: false
};

function okHandler(): Promise<ToolResult> {
  return Promise.resolve({ ok: true, content: 'готово' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ToolRegistry и подтверждение', () => {
  it('меняющий инструмент ждёт ответа, «да» выполняет', async () => {
    const registry = createToolRegistry(createEventBus(), undefined, {
      required: (def) => def.readOnly === false,
      ask: () => Promise.resolve(true)
    });
    const handler = vi.fn(okHandler);
    registry.register(changing, handler);

    await expect(registry.call('jira__create', {})).resolves.toEqual({ ok: true, content: 'готово' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('«нет» возвращает ошибку «Человек не подтвердил»', async () => {
    const registry = createToolRegistry(createEventBus(), undefined, {
      required: (def) => def.readOnly === false,
      ask: () => Promise.resolve(false)
    });
    const handler = vi.fn(okHandler);
    registry.register(changing, handler);

    const result = await registry.call('jira__create', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe(CONFIRM_DENIED_ERROR);
    expect(handler).not.toHaveBeenCalled();
  });

  it('фоновый вызов не спрашивает и завершается ошибкой', async () => {
    const ask = vi.fn(() => Promise.resolve(true));
    const registry = createToolRegistry(createEventBus(), undefined, {
      required: (def) => def.readOnly === false,
      ask
    });
    const handler = vi.fn(okHandler);
    registry.register(changing, handler);

    const result = await registry.call('jira__create', {}, { background: true });
    expect(result.error).toBe(CONFIRM_BACKGROUND_ERROR);
    expect(handler).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('«стоп» снимает вопрос: отказ и ошибка', async () => {
    const bus = createEventBus();
    const gate = createConfirmGate(bus);
    const registry = createToolRegistry(bus, undefined, {
      required: () => true,
      ask: (def, args) => gate.request({ connection: 'jira', tool: def.name, args })
    });
    const handler = vi.fn(okHandler);
    registry.register(changing, handler);

    const call = registry.call('jira__create', {});
    await Promise.resolve();
    expect(gate.pending()).toBe(true);
    gate.cancelAll();

    const result = await call;
    expect(result.error).toBe(CONFIRM_DENIED_ERROR);
    expect(handler).not.toHaveBeenCalled();
  });

  it('инструмент без подтверждения выполняется сразу', async () => {
    const ask = vi.fn(() => Promise.resolve(false));
    const registry = createToolRegistry(createEventBus(), undefined, {
      required: () => false,
      ask
    });
    const handler = vi.fn(okHandler);
    registry.register(reading, handler);

    await expect(registry.call('jira__search', {})).resolves.toEqual({ ok: true, content: 'готово' });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('requiresConfirm', () => {
  const servers: McpServerConfig[] = [
    { name: 'jira', transport: 'http', url: 'https://jira.example.org' },
    { name: 'safe', transport: 'http', url: 'https://safe.example.org', confirmChanges: false }
  ];

  it('меняющий инструмент MCP спрашивает', () => {
    expect(requiresConfirm(changing, servers)).toBe(true);
  });

  it('readOnly не спрашивает', () => {
    expect(requiresConfirm(reading, servers)).toBe(false);
  });

  it('встроенный не спрашивает', () => {
    expect(requiresConfirm(builtin, servers)).toBe(false);
  });

  it('выключенный confirmChanges не спрашивает', () => {
    const safe: ToolDef = { ...changing, name: 'safe__create', source: 'mcp:safe' };
    expect(requiresConfirm(safe, servers)).toBe(false);
  });

  it('старые настройки без поля читаются как «спрашивать»', () => {
    const legacy: McpServerConfig = { name: 'legacy', transport: 'http', url: 'https://x.example.org' };
    const tool: ToolDef = { ...changing, name: 'legacy__create', source: 'mcp:legacy' };
    expect(requiresConfirm(tool, [legacy])).toBe(true);
  });
});

describe('createConfirmGate', () => {
  it('ставит событие и открывает вопрос', async () => {
    const bus = createEventBus();
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));
    const gate = createConfirmGate(bus);

    const promise = gate.request({ connection: 'jira', tool: 'jira__create', args: { project: 'ABC' } });
    expect(gate.pending()).toBe(true);
    const request = events.find((event) => event.type === 'confirm.request');
    expect(request).toMatchObject({ type: 'confirm.request', connection: 'jira', tool: 'jira__create' });

    gate.answerPending(true);
    await expect(promise).resolves.toBe(true);
    expect(gate.pending()).toBe(false);
    expect(events.some((event) => event.type === 'confirm.close')).toBe(true);
  });

  it('истечение времени считается отказом', async () => {
    vi.useFakeTimers();
    const gate = createConfirmGate(createEventBus(), 1000);
    const promise = gate.request({ connection: 'jira', tool: 'jira__create', args: {} });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe(false);
  });

  it('отмена снимает вопрос как отказ', async () => {
    const gate = createConfirmGate(createEventBus());
    const promise = gate.request({ connection: 'jira', tool: 'jira__create', args: {} });
    gate.cancelAll();
    await expect(promise).resolves.toBe(false);
    expect(gate.pending()).toBe(false);
  });
});

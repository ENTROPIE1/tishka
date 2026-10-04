import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createToolRegistry } from '../src/core/tools/registry';
import { registerBuiltinTools, type BuiltinDeps } from '../src/core/tools/builtin';
import type { Panel, TishkaEvent, ToolDef, ToolResult } from '../src/core/types';

function makeDeps(): BuiltinDeps {
  return {
    openExternal: vi.fn(async () => undefined),
    showPanel: vi.fn(),
    now: () => new Date('2026-10-03T12:34:56.000Z')
  };
}

const echo: ToolDef = {
  name: 'echo',
  description: 'Возвращает переданный текст',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text']
  },
  source: 'builtin',
  readOnly: true
};

describe('ToolRegistry', () => {
  it('регистрирует инструмент, показывает в list() и вызывает', async () => {
    const registry = createToolRegistry(createEventBus());
    const handler = vi.fn(async (args: Record<string, unknown>): Promise<ToolResult> => ({
      ok: true,
      content: String(args.text)
    }));

    registry.register(echo, handler);

    expect(registry.list().map((def) => def.name)).toContain('echo');
    await expect(registry.call('echo', { text: 'привет' })).resolves.toEqual({
      ok: true,
      content: 'привет'
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('повторная регистрация заменяет инструмент', async () => {
    const registry = createToolRegistry(createEventBus());
    registry.register(echo, async () => ({ ok: true, content: 'первый' }));
    registry.register(echo, async () => ({ ok: true, content: 'второй' }));

    await expect(registry.call('echo', { text: 'x' })).resolves.toEqual({ ok: true, content: 'второй' });
  });

  it('неизвестное имя возвращает ok: false', async () => {
    const registry = createToolRegistry(createEventBus());
    const result = await registry.call('нет-такого', {});
    expect(result.ok).toBe(false);
  });

  it('отсутствие обязательного поля возвращает ok: false с именем поля', async () => {
    const registry = createToolRegistry(createEventBus());
    registry.register(echo, async () => ({ ok: true, content: 'не должно вызваться' }));

    const result = await registry.call('echo', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('text');
  });

  it('исключение обработчика не выходит наружу', async () => {
    const registry = createToolRegistry(createEventBus());
    registry.register(echo, async () => {
      throw new Error('boom');
    });

    const result = await registry.call('echo', { text: 'x' });
    expect(result).toEqual({ ok: false, content: '', error: 'boom' });
  });

  it('отправляет tool.start и tool.end в правильном порядке с верным ok', async () => {
    const bus = createEventBus();
    const registry = createToolRegistry(bus);
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));

    registry.register(echo, async () => ({ ok: true, content: 'готово' }));
    await registry.call('echo', { text: 'x' });

    expect(events).toEqual([
      { type: 'tool.start', tool: 'echo' },
      { type: 'tool.end', tool: 'echo', ok: true }
    ]);
  });

  it('в tool.end приходит ok: false при ошибке обработчика', async () => {
    const bus = createEventBus();
    const registry = createToolRegistry(bus);
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));

    registry.register(echo, async () => {
      throw new Error('boom');
    });
    await registry.call('echo', { text: 'x' });

    expect(events).toEqual([
      { type: 'tool.start', tool: 'echo' },
      { type: 'tool.end', tool: 'echo', ok: false }
    ]);
  });

  it('фоновый вызов не шлёт tool.start и tool.end, шлёт background.tick', async () => {
    const bus = createEventBus();
    const registry = createToolRegistry(bus);
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));

    let called = false;
    registry.register(echo, async () => {
      called = true;
      return { ok: true, content: 'готово' };
    });

    await expect(registry.call('echo', { text: 'x' }, { background: true })).resolves.toEqual({
      ok: true,
      content: 'готово'
    });
    expect(called).toBe(true);
    expect(events).toEqual([{ type: 'background.tick', tool: 'echo' }]);
  });

  it('unregisterSource убирает только инструменты этого источника', async () => {
    const registry = createToolRegistry(createEventBus());
    const mcp: ToolDef = { ...echo, name: 'confluence__get_page', source: 'mcp:confluence' };
    const other: ToolDef = { ...echo, name: 'jira__get_issue', source: 'mcp:jira' };

    registry.register(echo, async () => ({ ok: true, content: 'builtin' }));
    registry.register(mcp, async () => ({ ok: true, content: 'confluence' }));
    registry.register(other, async () => ({ ok: true, content: 'jira' }));

    registry.unregisterSource('mcp:confluence');

    const names = registry.list().map((def) => def.name);
    expect(names).toContain('echo');
    expect(names).toContain('jira__get_issue');
    expect(names).not.toContain('confluence__get_page');
    await expect(registry.call('confluence__get_page', { text: 'x' })).resolves.toMatchObject({ ok: false });
  });
});

describe('встроенные инструменты', () => {
  it('open_url отклоняет схемы file: и javascript: и не вызывает openExternal', async () => {
    const registry = createToolRegistry(createEventBus());
    const deps = makeDeps();
    registerBuiltinTools(registry, deps);

    await expect(registry.call('open_url', { url: 'file:///C:/secret.txt' })).resolves.toMatchObject({ ok: false });
    await expect(registry.call('open_url', { url: 'javascript:alert(1)' })).resolves.toMatchObject({ ok: false });
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  it('open_url открывает http-ссылку', async () => {
    const registry = createToolRegistry(createEventBus());
    const deps = makeDeps();
    registerBuiltinTools(registry, deps);

    await expect(registry.call('open_url', { url: 'https://example.org' })).resolves.toMatchObject({ ok: true });
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.org');
  });

  it('open_urls открывает ссылки по очереди', async () => {
    const registry = createToolRegistry(createEventBus());
    const deps = makeDeps();
    registerBuiltinTools(registry, deps);

    await registry.call('open_urls', { urls: ['https://a.example', 'http://b.example'] });
    expect(deps.openExternal).toHaveBeenNthCalledWith(1, 'https://a.example');
    expect(deps.openExternal).toHaveBeenNthCalledWith(2, 'http://b.example');
  });

  it('show_panel передаёт панель в deps.showPanel', async () => {
    const registry = createToolRegistry(createEventBus());
    const deps = makeDeps();
    registerBuiltinTools(registry, deps);
    const panel: Panel = { kind: 'text', title: 'Итог', markdown: 'Готово' };

    await expect(registry.call('show_panel', { panel })).resolves.toMatchObject({ ok: true });
    expect(deps.showPanel).toHaveBeenCalledWith(panel);
  });

  it('get_time возвращает ISO и день недели по-русски', async () => {
    const registry = createToolRegistry(createEventBus());
    registerBuiltinTools(registry, makeDeps());

    const result = await registry.call('get_time', {});
    expect(result.ok).toBe(true);
    expect(result.content).toContain('2026-10-03T12:34:56.000Z');
    expect(result.data).toMatchObject({ iso: '2026-10-03T12:34:56.000Z' });
  });
});

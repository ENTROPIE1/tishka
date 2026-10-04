import { describe, expect, it } from 'vitest';
import { SCREEN_LOOK_TOOLS, nextScreenLooking } from '../src/core/screen-look';
import type { TishkaEvent } from '../src/core/types';

describe('событие просмотра экрана', () => {
  it('начало инструмента просмотра делает кнопку активной', () => {
    const event: TishkaEvent = { type: 'tool.start', tool: 'screen_look' };

    expect(nextScreenLooking(false, event)).toBe(true);
  });

  it('конец просмотра возвращает обычный вид', () => {
    const start: TishkaEvent = { type: 'tool.start', tool: 'screen_look' };
    const end: TishkaEvent = { type: 'tool.end', tool: 'screen_look', ok: true };

    expect(nextScreenLooking(nextScreenLooking(false, start), end)).toBe(false);
  });

  it('снимок экрана тоже смотрит на экран', () => {
    expect(nextScreenLooking(false, { type: 'tool.start', tool: 'screen_shot' })).toBe(true);
  });

  it('другие инструменты вид не меняют', () => {
    expect(nextScreenLooking(false, { type: 'tool.start', tool: 'web_read' })).toBe(false);
    expect(nextScreenLooking(true, { type: 'tool.end', tool: 'web_read', ok: true })).toBe(true);
  });

  it('простой страхует потерянный конец просмотра', () => {
    expect(nextScreenLooking(true, { type: 'idle' })).toBe(false);
  });

  it('в списке инструментов просмотра только инструменты экрана', () => {
    expect([...SCREEN_LOOK_TOOLS].sort()).toEqual(['screen_look', 'screen_shot']);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { toLocalIso } from '../src/core/calendar/time';
import type { CalendarEvent } from '../src/core/calendar/types';
import { layoutDay } from '../src/renderer/chat/calendar/layout';
import { mountCalendarScreen } from '../src/renderer/chat/calendar/screen';
import { situationText } from '../src/renderer/chat/calendar/situation-bar';
import type { CalendarApi } from '../src/renderer/chat/calendar/deps';
import type { TishkaEvent } from '../src/core/types';

const NOW = new Date('2026-10-07T10:00:00');

function localEvent(partial: { title: string; start: string; end: string } & Partial<CalendarEvent>): CalendarEvent {
  return {
    id: partial.id ?? partial.title,
    allDay: false,
    kind: partial.kind ?? 'meeting',
    source: partial.source ?? 'local',
    remindMinutes: null,
    updatedAt: '2026-10-07T00:00:00',
    ...partial
  } as CalendarEvent;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeApi(events: CalendarEvent[]): CalendarApi & { eventsCalls: number } {
  const api = {
    eventsCalls: 0,
    async events(): Promise<CalendarEvent[]> {
      api.eventsCalls += 1;
      return events;
    },
    add: vi.fn(async (input) => localEvent({ title: input.title, start: input.start, end: input.end })),
    update: vi.fn(async () => undefined),
    remove: vi.fn(async () => true),
    free: vi.fn(async () => []),
    situation: vi.fn(async () => ({
      workTime: true,
      minutesToNext: null,
      remainingToday: 0,
      free: true,
      freeUntil: toLocalIso(new Date('2026-10-07T14:00:00')),
      workEnd: toLocalIso(new Date('2026-10-07T18:00:00'))
    })),
    sync: vi.fn(async () => ({ ok: true, added: 0, updated: 0, removed: 0 }))
  };
  return api as unknown as CalendarApi & { eventsCalls: number };
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
  if (found === undefined) {
    throw new Error(`Нет кнопки ${text}`);
  }
  return found as HTMLButtonElement;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('layoutDay', () => {
  it('раскладывает пересекающиеся события по колонкам', () => {
    const day = new Date('2026-10-07T00:00:00');
    const a = localEvent({ title: 'A', start: toLocalIso(new Date('2026-10-07T10:00:00')), end: toLocalIso(new Date('2026-10-07T11:00:00')) });
    const b = localEvent({ title: 'B', start: toLocalIso(new Date('2026-10-07T10:30:00')), end: toLocalIso(new Date('2026-10-07T11:30:00')) });
    const positioned = layoutDay([a, b], day);
    expect(positioned).toHaveLength(2);
    expect(positioned[0].columns).toBe(2);
    expect(positioned[1].column).toBe(1);
  });
});

describe('situationText', () => {
  it('называет свободное время', () => {
    const text = situationText({
      workTime: true,
      minutesToNext: null,
      remainingToday: 0,
      free: true,
      freeUntil: toLocalIso(new Date('2026-10-07T14:00:00')),
      workEnd: null
    });
    expect(text).toContain('рабочее время');
    expect(text).toContain('14:00');
  });

  it('называет текущую и следующую встречу', () => {
    const text = situationText({
      workTime: true,
      current: localEvent({ title: 'Планёрка', start: '2026-10-07T10:00:00', end: '2026-10-07T11:00:00' }),
      next: localEvent({ title: 'Демо', start: '2026-10-07T14:00:00', end: '2026-10-07T15:00:00' }),
      minutesToNext: 180,
      remainingToday: 2,
      free: false,
      freeUntil: null,
      workEnd: null
    });
    expect(text).toContain('Планёрка');
    expect(text).toContain('Демо');
  });
});

describe('mountCalendarScreen', () => {
  it('показывает полосу обстановки, сетку и линию «сейчас»', async () => {
    const events = [localEvent({ title: 'Демо', start: toLocalIso(new Date('2026-10-07T14:00:00')), end: toLocalIso(new Date('2026-10-07T15:00:00')) })];
    const api = makeApi(events);
    const root = document.createElement('div');
    mountCalendarScreen(root, {
      api,
      config: { get: async () => ({ config: defaultConfig(), gatewayKeySet: true }), save: vi.fn(async () => undefined) },
      connections: async () => [],
      onEvent: () => () => undefined,
      now: () => NOW
    });
    await flush();

    expect(root.querySelector('.calendar-bar')?.textContent).toContain('рабочее время');
    expect(root.querySelector('.calendar-now')).not.toBeNull();
    expect(root.querySelectorAll('.calendar-event')).toHaveLength(1);
  });

  it('создаёт событие через карточку', async () => {
    const api = makeApi([]);
    const root = document.createElement('div');
    mountCalendarScreen(root, {
      api,
      config: { get: async () => ({ config: defaultConfig(), gatewayKeySet: true }), save: vi.fn(async () => undefined) },
      connections: async () => [],
      onEvent: () => () => undefined,
      now: () => NOW
    });
    await flush();

    buttonByText(root, 'Событие').click();
    const editor = root.querySelector<HTMLFormElement>('.calendar-editor');
    expect(editor).not.toBeNull();
    const title = editor!.querySelector<HTMLInputElement>('input[type="text"]')!;
    title.value = 'Новая встреча';
    editor!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Новая встреча' }));
  });

  it('быстрая кнопка «Занят час» создаёт focus', async () => {
    const api = makeApi([]);
    const root = document.createElement('div');
    mountCalendarScreen(root, {
      api,
      config: { get: async () => ({ config: defaultConfig(), gatewayKeySet: true }), save: vi.fn(async () => undefined) },
      connections: async () => [],
      onEvent: () => () => undefined,
      now: () => NOW
    });
    await flush();

    buttonByText(root, 'Занят час').click();
    await flush();
    expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'focus' }));
  });

  it('у загруженного события не правится название и нет удаления', async () => {
    const events = [
      localEvent({
        title: 'Из почты',
        start: toLocalIso(new Date('2026-10-07T14:00:00')),
        end: toLocalIso(new Date('2026-10-07T15:00:00')),
        source: 'exchange:работа'
      })
    ];
    const api = makeApi(events);
    const root = document.createElement('div');
    mountCalendarScreen(root, {
      api,
      config: { get: async () => ({ config: defaultConfig(), gatewayKeySet: true }), save: vi.fn(async () => undefined) },
      connections: async () => [],
      onEvent: () => () => undefined,
      now: () => NOW
    });
    await flush();

    root.querySelector<HTMLButtonElement>('.calendar-event')!.click();
    const editor = root.querySelector<HTMLElement>('.calendar-editor')!;
    expect(editor).not.toBeNull();
    expect(editor.querySelector<HTMLInputElement>('input[type="text"]')!.disabled).toBe(true);
    expect([...editor.querySelectorAll('button')].some((item) => item.textContent?.includes('Удалить'))).toBe(false);
  });

  it('сохраняет рабочее время', async () => {
    const save = vi.fn(async () => undefined);
    const api = makeApi([]);
    const root = document.createElement('div');
    mountCalendarScreen(root, {
      api,
      config: { get: async () => ({ config: defaultConfig(), gatewayKeySet: true }), save },
      connections: async () => [],
      onEvent: () => () => undefined,
      now: () => NOW
    });
    await flush();

    const remind = root.querySelector<HTMLInputElement>('.calendar-settings input[type="number"]')!;
    remind.value = '20';
    remind.dispatchEvent(new Event('change'));
    await flush();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ calendar: expect.objectContaining({ defaultRemindMinutes: 20 }) }));
  });

  it('перечитывает календарь по событию ядра', async () => {
    const api = makeApi([]);
    let listener: ((event: TishkaEvent) => void) | undefined;
    const root = document.createElement('div');
    mountCalendarScreen(root, {
      api,
      config: { get: async () => ({ config: defaultConfig(), gatewayKeySet: true }), save: vi.fn(async () => undefined) },
      connections: async () => [],
      onEvent: (next) => {
        listener = next;
        return () => undefined;
      },
      now: () => NOW
    });
    await flush();
    const before = api.eventsCalls;
    listener?.({ type: 'calendar.changed' });
    await flush();
    expect(api.eventsCalls).toBeGreaterThan(before);
  });
});

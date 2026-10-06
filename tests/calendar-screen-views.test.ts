// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config';
import type { CalendarEvent } from '../src/core/calendar/types';
import type { CalendarApi } from '../src/renderer/chat/calendar/deps';
import { mountCalendarScreen } from '../src/renderer/chat/calendar/screen';
import { GUTTER_WIDTH, HOUR_HEIGHT } from '../src/renderer/chat/calendar/grid';
import type { ConnectionView } from '../src/main/settings-types';

const NOW = new Date('2026-10-07T10:00:00');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CALENDAR_CSS = readFileSync(resolve(ROOT, 'src/renderer/chat/calendar/calendar.css'), 'utf8');
const SETTINGS_CSS = readFileSync(resolve(ROOT, 'src/renderer/settings/settings.css'), 'utf8');

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

function makeApi(events: CalendarEvent[]): CalendarApi {
  return {
    events: vi.fn(async () => events),
    add: vi.fn(async (input) => localEvent({ title: input.title, start: input.start, end: input.end })),
    update: vi.fn(async () => undefined),
    remove: vi.fn(async () => true),
    free: vi.fn(async () => []),
    situation: vi.fn(async () => ({
      workTime: true,
      minutesToNext: null,
      remainingToday: 0,
      free: true,
      freeUntil: null,
      workEnd: null
    })),
    sync: vi.fn(async () => ({ ok: true, added: 0, updated: 0, removed: 0 }))
  };
}

function exchangeConnection(name: string): ConnectionView {
  return { name, template: 'exchange', address: 'https://mail.example', fields: {}, secrets: [], state: 'connected', tools: 0 };
}

function setup(events: CalendarEvent[], connections: ConnectionView[] = []): { api: CalendarApi; root: HTMLElement } {
  const api = makeApi(events);
  const root = document.createElement('div');
  mountCalendarScreen(root, {
    api,
    config: { get: async () => ({ config: defaultConfig(), gatewayKeySet: true }), save: vi.fn(async () => undefined) },
    connections: async () => connections,
    onEvent: () => () => undefined,
    now: () => NOW
  });
  return { api, root };
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

describe('вид «Неделя»', () => {
  it('показывает заголовок и семь колонок', async () => {
    const { root } = setup([]);
    await flush();
    buttonByText(root, 'Неделя').click();
    await flush();

    expect(root.querySelector('.calendar-week-header')).not.toBeNull();
    expect(root.querySelectorAll('.calendar-col')).toHaveLength(7);
  });
});

describe('ровная сетка календаря', () => {
  it('в неделе желоб один у шапки, «весь день» и колонки часов', async () => {
    const { root } = setup([]);
    await flush();
    buttonByText(root, 'Неделя').click();
    await flush();

    const headerGutter = root.querySelector<HTMLElement>('.calendar-week-gutter');
    const alldayGutter = root.querySelector<HTMLElement>('.calendar-allday-gutter');
    const times = root.querySelector<HTMLElement>('.calendar-times');
    expect(headerGutter).not.toBeNull();
    expect(alldayGutter).not.toBeNull();
    expect(times).not.toBeNull();

    const width = `${GUTTER_WIDTH}px`;
    expect(headerGutter!.style.width).toBe(width);
    expect(alldayGutter!.style.width).toBe(width);
    expect(times!.style.width).toBe(width);
  });

  it('число колонок дней совпадает в шапке, «весь день» и теле', async () => {
    const { root } = setup([]);
    await flush();
    buttonByText(root, 'Неделя').click();
    await flush();

    const headerDays = root.querySelectorAll('.calendar-week-day');
    const alldayDays = root.querySelectorAll('.calendar-allday-cell');
    const bodyDays = root.querySelectorAll('.calendar-col');
    expect(headerDays).toHaveLength(7);
    expect(alldayDays).toHaveLength(7);
    expect(bodyDays).toHaveLength(7);
  });

  it('24 клетки часов и 24 подписи высотой HOUR_HEIGHT', async () => {
    const { root } = setup([]);
    await flush();

    const times = [...root.querySelectorAll<HTMLElement>('.calendar-time')];
    const hours = [...root.querySelectorAll<HTMLElement>('.calendar-hour')];
    expect(times).toHaveLength(24);
    expect(hours).toHaveLength(24);
    for (const cell of [...times, ...hours]) {
      expect(cell.style.height).toBe(`${HOUR_HEIGHT}px`);
    }
  });

  it('событие стоит на линии по минутам начала', async () => {
    const event = localEvent({ title: 'Ровное', start: '2026-10-07T02:30:00', end: '2026-10-07T03:00:00' });
    const { root } = setup([event]);
    await flush();

    const block = root.querySelector<HTMLElement>('.calendar-col-events .calendar-event');
    expect(block).not.toBeNull();
    expect(block!.style.top).toBe(`${(150 / 60) * HOUR_HEIGHT}px`);
  });

  it('вид «День» остаётся одной колонкой с желобом', async () => {
    const { root } = setup([]);
    await flush();

    expect(root.querySelector('.calendar-week-header')).toBeNull();
    expect(root.querySelectorAll('.calendar-col')).toHaveLength(1);
    expect(root.querySelectorAll('.calendar-allday-cell')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('.calendar-times')?.style.width).toBe(`${GUTTER_WIDTH}px`);
    expect(root.querySelector<HTMLElement>('.calendar-allday-gutter')?.style.width).toBe(`${GUTTER_WIDTH}px`);
  });
});

describe('создание по шкале', () => {
  it('щелчок по пустому месту открывает карточку с выбранным временем', async () => {
    const { root } = setup([]);
    await flush();

    const hours = root.querySelector<HTMLElement>('.calendar-col-hours')!;
    hours.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 440 }));

    const editor = root.querySelector<HTMLFormElement>('.calendar-editor');
    expect(editor).not.toBeNull();
    expect(editor!.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe('10:00');
  });
});

describe('правка и удаление своих событий', () => {
  it('позволяет менять дату и время своего события', async () => {
    const event = localEvent({ title: 'Своё', start: '2026-10-07T14:00:00', end: '2026-10-07T15:00:00' });
    const { api, root } = setup([event]);
    await flush();

    root.querySelector<HTMLButtonElement>('.calendar-event')!.click();
    const editor = root.querySelector<HTMLFormElement>('.calendar-editor')!;
    expect(editor.querySelector('input[type="date"]')).not.toBeNull();
    editor.querySelector<HTMLInputElement>('input[type="text"]')!.value = 'Перенесённое';
    editor.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    expect(api.update).toHaveBeenCalledWith('Своё', expect.objectContaining({ title: 'Перенесённое' }));
  });

  it('удаляет своё событие после подтверждения', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const event = localEvent({ title: 'Своё', start: '2026-10-07T14:00:00', end: '2026-10-07T15:00:00' });
    const { api, root } = setup([event]);
    await flush();

    root.querySelector<HTMLButtonElement>('.calendar-event')!.click();
    buttonByText(root, 'Удалить').click();
    await flush();

    expect(api.remove).toHaveBeenCalledWith('Своё');
  });
});

describe('быстрые кнопки', () => {
  it('«Занят до конца дня» создаёт focus до конца рабочего дня', async () => {
    const { api, root } = setup([]);
    await flush();

    buttonByText(root, 'Занят до конца дня').click();
    await flush();

    const end = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 18, 0).toISOString();
    expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'focus', end }));
  });
});

describe('блоки настроек', () => {
  it('показывает рабочее время и источники с подписью', async () => {
    const { root } = setup([], [exchangeConnection('работа')]);
    await flush();

    const settings = root.querySelector('.calendar-settings')!;
    expect(settings.textContent).toContain('Рабочее время');
    expect(settings.textContent).toContain('Источники');
    expect(settings.textContent).toContain('Загружать встречи');
    expect(settings.querySelector('.calendar-source')).not.toBeNull();
  });
});

describe('значки событий', () => {
  it('помечает загруженное из почты событие значком источника', async () => {
    const event = localEvent({
      title: 'Из почты',
      start: '2026-10-07T14:00:00',
      end: '2026-10-07T15:00:00',
      source: 'exchange:работа'
    });
    const { root } = setup([event]);
    await flush();

    const block = root.querySelector('.calendar-event')!;
    expect(block.querySelector('.calendar-event-icon')).not.toBeNull();
    expect(block.querySelector('.calendar-event-source')?.textContent).toBe('почта');
  });
});

describe('пустой календарь', () => {
  it('показывает подсказку', async () => {
    const { root } = setup([]);
    await flush();

    expect(root.querySelector('.calendar-empty')?.textContent).toContain('поставь в календарь');
  });
});

describe('вёрстка', () => {
  it('тёмная тема задана переменными', () => {
    expect(SETTINGS_CSS).toContain('prefers-color-scheme: dark');
    expect(CALENDAR_CSS).toContain('var(--surface)');
    expect(CALENDAR_CSS).not.toMatch(/#fff/i);
  });

  it('при ширине 900 нет горизонтальной прокрутки', () => {
    expect(CALENDAR_CSS).toContain('overflow-x: hidden');
    expect(CALENDAR_CSS).toContain('min-width: 0');
  });
});

import type { ToolDef } from '../types';
import type { CalendarKind } from './types';

export const CALENDAR_KINDS: CalendarKind[] = ['meeting', 'focus', 'personal', 'reminder', 'away'];

export const agendaTool: ToolDef = {
  name: 'calendar_agenda',
  description: 'Показывает события календаря за период: сегодня, завтра, неделю или указанные даты.',
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', description: 'today, tomorrow, week или даты ГГГГ-ММ-ДД' },
      from: { type: 'string', description: 'Начало периода, ISO' },
      to: { type: 'string', description: 'Конец периода, ISO' }
    },
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

export const addTool: ToolDef = {
  name: 'calendar_add',
  description: 'Заводит событие в календаре. Время можно задать словами: «завтра в 15», «в пятницу с 10 до 11», «через час на 30 минут».',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Название события' },
      when: { type: 'string', description: 'Начало словами или с концом/длительностью' },
      start: { type: 'string', description: 'Начало: ISO или словами' },
      end: { type: 'string', description: 'Конец' },
      durationMinutes: { type: 'number', description: 'Длительность в минутах' },
      allDay: { type: 'boolean', description: 'Событие на весь день' },
      kind: { type: 'string', enum: CALENDAR_KINDS, description: 'Вид события' },
      remindMinutes: { type: ['number', 'null'], description: 'За сколько минут напомнить, null — не напоминать' },
      location: { type: 'string' },
      link: { type: 'string' },
      note: { type: 'string' }
    },
    required: ['title'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

export const updateTool: ToolDef = {
  name: 'calendar_update',
  description: 'Изменяет своё событие календаря. У загруженных событий меняются только напоминание и заметка.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      allDay: { type: 'boolean' },
      kind: { type: 'string', enum: CALENDAR_KINDS },
      remindMinutes: { type: ['number', 'null'] },
      location: { type: 'string' },
      link: { type: 'string' },
      note: { type: 'string' }
    },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

export const removeTool: ToolDef = {
  name: 'calendar_remove',
  description: 'Удаляет своё событие календаря по идентификатору.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

export const freeTool: ToolDef = {
  name: 'calendar_free',
  description: 'Показывает свободные окна в рабочее время дня.',
  inputSchema: {
    type: 'object',
    properties: {
      day: { type: 'string', description: 'День, ISO или ГГГГ-ММ-ДД, по умолчанию сегодня' },
      durationMinutes: { type: 'number', description: 'Нужная длительность окна, по умолчанию 30' }
    },
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

export const statusTool: ToolDef = {
  name: 'calendar_status',
  description: 'Сообщает обстановку в календаре сейчас: рабочее ли время, что идёт, что дальше, свободен ли человек.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  source: 'builtin',
  readOnly: true
};

export const syncTool: ToolDef = {
  name: 'calendar_sync',
  description:
    'Переносит встречи из почтового календаря Exchange в календарь Тишки. С параметром enable=true включает перенос, с enable=false выключает. Без параметра просто обновляет встречи сейчас.',
  inputSchema: {
    type: 'object',
    properties: {
      enable: { type: 'boolean', description: 'true — включить перенос встреч из почты, false — выключить' }
    },
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

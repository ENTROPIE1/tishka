import type { ToolDef } from '../types';

export const saveTool: ToolDef = {
  name: 'memory_save',
  description: 'Сохраняет в долгую память несколько фактов за один вызов, по одному факту в записи.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Записи: text, tags и reviewDays',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            reviewDays: { type: 'number' }
          },
          required: ['text']
        }
      }
    },
    required: ['items'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

export const searchTool: ToolDef = {
  name: 'memory_search',
  description: 'Ищет записи в долгой памяти по смыслу фразы.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Фраза для поиска' },
      limit: { type: 'number', description: 'Сколько записей вернуть' }
    },
    required: ['query'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

export const updateTool: ToolDef = {
  name: 'memory_update',
  description: 'Меняет текст, метки или срок проверки одной записи памяти по её идентификатору.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Идентификатор записи' },
      text: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      reviewDays: { type: ['number', 'null'] }
    },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

export const forgetTool: ToolDef = {
  name: 'memory_forget',
  description: 'Удаляет одну запись из долгой памяти по её идентификатору.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Идентификатор записи' }
    },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

export const confirmTool: ToolDef = {
  name: 'memory_confirm',
  description: 'Отмечает записи как всё ещё верные и сдвигает срок их следующей проверки.',
  inputSchema: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' }, description: 'Идентификаторы записей' }
    },
    required: ['ids'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

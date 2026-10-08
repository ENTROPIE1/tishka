import { describe, expect, it } from 'vitest';
import { renderTemplate, type TemplateContext } from '../src/core/skills/template';

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    inputs: {},
    steps: {},
    now: new Date('2026-10-03T12:34:56.000Z'),
    ...overrides
  };
}

describe('renderTemplate', () => {
  it('подставляет вход', () => {
    const ctx = makeContext({ inputs: { name: 'Ира' } });
    expect(renderTemplate('привет, {{inputs.name}}', ctx)).toBe('привет, Ира');
  });

  it('подставляет текст шага', () => {
    const ctx = makeContext({ steps: { first: { content: 'готово' } } });
    expect(renderTemplate('{{steps.first.content}}', ctx)).toBe('готово');
  });

  it('подставляет поле из data', () => {
    const ctx = makeContext({
      steps: { first: { content: 'ок', data: { user: { name: 'Пётр' } } } }
    });
    expect(renderTemplate('{{steps.first.data.user.name}}', ctx)).toBe('Пётр');
  });

  it('подставляет элемент массива по индексу', () => {
    const ctx = makeContext({
      steps: { first: { content: 'ок', data: { items: [{ url: 'https://a.example' }, { url: 'https://b.example' }] } } }
    });
    expect(renderTemplate('{{steps.first.data.items.1.url}}', ctx)).toBe('https://b.example');
  });

  it('подставляет now и today', () => {
    const ctx = makeContext();
    expect(renderTemplate('{{now}}', ctx)).toBe('2026-10-03T12:34:56.000Z');
    expect(renderTemplate('{{today}}', ctx)).toBe('2026-10-03');
  });

  it('строка из одной подстановки сохраняет тип значения', () => {
    const ctx = makeContext({
      inputs: { list: [1, 2, 3], flag: true },
      steps: { first: { content: 'ок', data: { items: [{ url: 'x' }] } } }
    });
    expect(renderTemplate('{{inputs.list}}', ctx)).toEqual([1, 2, 3]);
    expect(renderTemplate('{{inputs.flag}}', ctx)).toBe(true);
    expect(renderTemplate('{{steps.first.data.items}}', ctx)).toEqual([{ url: 'x' }]);
  });

  it('строку с текстом вокруг подстановки склеивает в текст', () => {
    const ctx = makeContext({ inputs: { list: [1, 2, 3] } });
    expect(renderTemplate('итог: {{inputs.list}}!', ctx)).toBe('итог: [1,2,3]!');
  });

  it('рекурсивно обходит массивы и объекты', () => {
    const ctx = makeContext({ inputs: { name: 'Ира' } });
    expect(renderTemplate({ greeting: '{{inputs.name}}', list: ['{{inputs.name}}'] }, ctx)).toEqual({
      greeting: 'Ира',
      list: ['Ира']
    });
  });

  it('неизвестная подстановка — ошибка с её названием', () => {
    const ctx = makeContext();
    expect(() => renderTemplate('{{inputs.missing}}', ctx)).toThrow(/inputs\.missing/);
    expect(() => renderTemplate('{{steps.nope.content}}', ctx)).toThrow(/steps\.nope\.content/);
  });

  it('ошибка при обращении к полю, которого нет в data', () => {
    const ctx = makeContext({ steps: { first: { content: 'ок' } } });
    expect(() => renderTemplate('{{steps.first.data.x}}', ctx)).toThrow(/steps\.first\.data\.x/);
  });

  it('next.tue — ближайший вторник, сегодня если ещё не 17:00', () => {
    const saturday = makeContext({ now: new Date(2026, 9, 3, 12, 0, 0) });
    expect(renderTemplate('{{next.tue}}', saturday)).toBe('2026-10-06');
    const tuesdayMorning = makeContext({ now: new Date(2026, 9, 6, 10, 0, 0) });
    expect(renderTemplate('{{next.tue}}', tuesdayMorning)).toBe('2026-10-06');
    const tuesdayEvening = makeContext({ now: new Date(2026, 9, 6, 18, 0, 0) });
    expect(renderTemplate('{{next.tue}}', tuesdayEvening)).toBe('2026-10-13');
  });
});

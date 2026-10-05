import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/core/agent/prompt';

const NOW = new Date('2026-10-07T10:00:00');

describe('подсказка о календаре', () => {
  it('включает правило про инструменты календаря', () => {
    const prompt = buildSystemPrompt(NOW);
    expect(prompt).toContain('calendar_add');
    expect(prompt).toContain('calendar_agenda');
  });

  it('включает строку обстановки, когда она есть', () => {
    const prompt = buildSystemPrompt(NOW, 'sometimes', undefined, undefined, undefined, 'Сейчас рабочее время, свободен до 14:00.');
    expect(prompt).toContain('Обстановка в календаре: Сейчас рабочее время');
  });

  it('без обстановки строки нет', () => {
    const prompt = buildSystemPrompt(NOW);
    expect(prompt).not.toContain('Обстановка в календаре');
  });
});

import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/core/agent/prompt';

describe('подсказка модели о подтверждении', () => {
  it('одна строка про подтверждение и отказ есть в подсказке', () => {
    const prompt = buildSystemPrompt(new Date('2026-10-03T12:00:00.000Z'));
    expect(prompt).toContain('требуют подтверждения человека');
    expect(prompt).toContain('Человек не подтвердил');
    expect(prompt).toContain('не повторяй попытку');
  });
});

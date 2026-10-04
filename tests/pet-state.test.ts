import { describe, expect, it } from 'vitest';
import type { Panel, TishkaEvent } from '../src/core/types';
import { initialPet, onEvent, onTick, type PetModel, type PetOpts } from '../src/pet/state';

const MODE_OFF: PetOpts = { petMode: false };
const MODE_ON: PetOpts = { petMode: true };
const PANEL: Panel = { kind: 'text', title: 'Ответ', markdown: 'подробности' };

function fire(model: PetModel, event: TishkaEvent, now: number, opts: PetOpts = MODE_OFF): PetModel {
  return onEvent(model, event, now, opts);
}

describe('pet state', () => {
  it('wake из hidden даёт appear, через 900 мс — listening', () => {
    let model = fire(initialPet(0), { type: 'wake', source: 'hotkey' }, 0);
    expect(model.state).toBe('appear');

    model = onTick(model, 900, MODE_OFF);
    expect(model.state).toBe('listening');
  });

  it('listen.end → thinking, tool.start → working, tool.end → thinking', () => {
    let model = fire(initialPet(0), { type: 'listen.end', text: 'привет' }, 0);
    expect(model.state).toBe('thinking');

    model = fire(model, { type: 'tool.start', tool: 't' }, 1);
    expect(model.state).toBe('working');

    model = fire(model, { type: 'tool.end', tool: 't', ok: true }, 2);
    expect(model.state).toBe('thinking');
  });

  it('reply с текстом из 50 знаков: talking, через 1500+50·60 мс — idle, say и panel сохранены', () => {
    const say = 'а'.repeat(50);
    let model = fire(initialPet(0), { type: 'reply', reply: { say, show: PANEL } }, 0);

    expect(model.state).toBe('talking');
    expect(model.say).toBe(say);
    expect(model.panel).toEqual(PANEL);

    model = onTick(model, 4499, MODE_OFF);
    expect(model.state).toBe('talking');

    model = onTick(model, 4500, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('reply с ask держит карточку ввода, следующий ответ её заменяет', () => {
    const ask = { title: 'Пришли текст', placeholder: 'заметки' };
    let model = fire(initialPet(0), { type: 'reply', reply: { say: 'Пришли заметки', ask } }, 0);

    expect(model.state).toBe('talking');
    expect(model.ask).toEqual(ask);
    expect(model.panel).toBeUndefined();

    model = fire(model, { type: 'reply', reply: { say: 'Готово', show: PANEL } }, 10);
    expect(model.ask).toBeUndefined();
    expect(model.panel).toEqual(PANEL);
  });

  it('reply с mood happy: сначала happy, затем talking', () => {
    let model = fire(initialPet(0), { type: 'reply', reply: { say: 'ура', mood: 'happy' } }, 0);
    expect(model.state).toBe('happy');

    model = onTick(model, 1500, MODE_OFF);
    expect(model.state).toBe('talking');
  });

  it('notify из hidden: appear, затем notify, затем idle', () => {
    let model = fire(initialPet(0), { type: 'notify', title: 'событие' }, 0);
    expect(model.state).toBe('appear');

    model = onTick(model, 900, MODE_OFF);
    expect(model.state).toBe('notify');

    model = onTick(model, 2400, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('notify во время talking не обрывает его', () => {
    let model = fire(initialPet(0), { type: 'reply', reply: { say: 'привет' } }, 0);
    model = fire(model, { type: 'notify', title: 'событие' }, 10);
    expect(model.state).toBe('talking');
    expect(model.queue).toContain('notify');

    model = onTick(model, 1500 + 6 * 60, MODE_OFF);
    expect(model.state).toBe('notify');
  });

  it('30 секунд idle при petMode false: leave, затем hidden, облачко и карточка очищены', () => {
    let model = fire(initialPet(0), { type: 'reply', reply: { say: 'привет', show: PANEL } }, 0);
    model = onTick(model, 1500 + 6 * 60, MODE_OFF);
    expect(model.state).toBe('idle');

    model = onTick(model, 30000 + 1500 + 6 * 60, MODE_OFF);
    expect(model.state).toBe('leave');

    model = onTick(model, 30900 + 1500 + 6 * 60, MODE_OFF);
    expect(model.state).toBe('hidden');
    expect(model.say).toBeUndefined();
    expect(model.panel).toBeUndefined();
  });

  it('при petMode true ухода нет, через 5 минут — sleep, wake из sleep даёт appear', () => {
    let model = fire(initialPet(0), { type: 'idle' }, 0);
    expect(model.state).toBe('idle');

    model = onTick(model, 300000 - 1, MODE_ON);
    expect(model.state).toBe('idle');

    model = onTick(model, 300000, MODE_ON);
    expect(model.state).toBe('sleep');

    model = fire(model, { type: 'wake', source: 'click' }, 300000, MODE_ON);
    expect(model.state).toBe('appear');
  });

  it('при opts.busy отсчёт простоя не идёт', () => {
    let model = fire(initialPet(0), { type: 'idle' }, 0);
    model = onTick(model, 30001, { petMode: false, busy: true });
    expect(model.state).toBe('idle');

    model = onTick(model, 60001, { petMode: false, busy: true });
    expect(model.state).toBe('idle');

    model = onTick(model, 89999, { petMode: false, busy: false });
    expect(model.state).toBe('idle');

    model = onTick(model, 90001, { petMode: false, busy: false });
    expect(model.state).toBe('leave');
  });

  it('thinking дольше 90 секунд без событий → idle', () => {
    let model = fire(initialPet(0), { type: 'listen.end', text: 'привет' }, 0);
    expect(model.state).toBe('thinking');

    model = onTick(model, 89_999, MODE_OFF);
    expect(model.state).toBe('thinking');

    model = onTick(model, 90_000, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('working дольше 90 секунд без событий → idle', () => {
    let model = fire(initialPet(0), { type: 'tool.start', tool: 't' }, 0);
    expect(model.state).toBe('working');

    model = onTick(model, 90_000, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('новое событие сбрасывает отсчёт страховки', () => {
    let model = fire(initialPet(0), { type: 'tool.start', tool: 't' }, 0);
    model = fire(model, { type: 'tool.start', tool: 't' }, 89_000);
    expect(model.state).toBe('working');

    model = onTick(model, 90_000, MODE_OFF);
    expect(model.state).toBe('working');

    model = onTick(model, 179_000, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('error → confused → idle', () => {
    let model = fire(initialPet(0), { type: 'error', message: 'беда' }, 0);
    expect(model.state).toBe('confused');

    model = onTick(model, 1500, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('счётчик ответов растёт на каждом reply и держится при переходах', () => {
    let model = fire(initialPet(0), { type: 'reply', reply: { say: 'раз' } }, 0);
    expect(model.replies).toBe(1);

    model = fire(model, { type: 'reply', reply: { say: 'два' } }, 100);
    expect(model.replies).toBe(2);

    model = onTick(model, 10_000, MODE_OFF);
    expect(model.state).toBe('idle');
    expect(model.replies).toBe(2);
  });
});

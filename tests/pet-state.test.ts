import { describe, expect, it } from 'vitest';
import type { Panel, TishkaEvent } from '../src/core/types';
import { initialPet, onEvent, onTick, type PetModel, type PetOpts } from '../src/pet/state';

const MODE_OFF: PetOpts = { petMode: false };
const MODE_ON: PetOpts = { petMode: true };
const FROM_CHAT: PetOpts = { petMode: false, source: 'chat' };
const PANEL: Panel = { kind: 'text', title: 'Ответ', markdown: 'подробности' };

function fire(model: PetModel, event: TishkaEvent, now: number, opts: PetOpts = MODE_OFF): PetModel {
  return onEvent(model, event, now, opts);
}

// Видимое состояние idle: ёж уже появился и не занят.
function ready(now = 0): PetModel {
  let model = fire(initialPet(now), { type: 'wake', source: 'name' }, now);
  model = onTick(model, now + 900, MODE_OFF);
  return fire(model, { type: 'idle' }, now + 900);
}

describe('pet state: появление всегда через appear', () => {
  it('из hidden любое показывающее событие ведёт через appear', () => {
    const events: TishkaEvent[] = [
      { type: 'wake', source: 'name' },
      { type: 'wake', source: 'hotkey' },
      { type: 'wake', source: 'click' },
      { type: 'wake', source: 'trigger' },
      { type: 'listen.start' },
      { type: 'think.start' },
      { type: 'reply', reply: { say: 'привет' } },
      { type: 'notify', title: 'событие' }
    ];

    for (const event of events) {
      const model = fire(initialPet(0), event, 0);
      expect(model.state, event.type).toBe('appear');
    }
  });

  it('wake из hidden даёт appear, через 900 мс — listening', () => {
    let model = fire(initialPet(0), { type: 'wake', source: 'hotkey' }, 0);
    expect(model.state).toBe('appear');

    model = onTick(model, 900, MODE_OFF);
    expect(model.state).toBe('listening');
  });

  it('reply при скрытом еже: appear, затем talking, реплика и карточка сохранены', () => {
    let model = fire(initialPet(0), { type: 'reply', reply: { say: 'привет', show: PANEL } }, 0);
    expect(model.state).toBe('appear');
    expect(model.say).toBe('привет');

    model = onTick(model, 900, MODE_OFF);
    expect(model.state).toBe('talking');
    expect(model.panel).toEqual(PANEL);
  });

  it('idle при скрытом еже не поднимает окно', () => {
    expect(fire(initialPet(0), { type: 'idle' }, 0).state).toBe('hidden');
    expect(fire(initialPet(0), { type: 'speak.end' }, 0).state).toBe('hidden');
  });
});

describe('pet state: ход разговора', () => {
  it('listen.end → thinking, tool.start → working, tool.end → thinking', () => {
    let model = fire(ready(0), { type: 'listen.end', text: 'привет' }, 1000);
    expect(model.state).toBe('thinking');

    model = fire(model, { type: 'tool.start', tool: 't' }, 1001);
    expect(model.state).toBe('working');

    model = fire(model, { type: 'tool.end', tool: 't', ok: true }, 1002);
    expect(model.state).toBe('thinking');
  });

  it('reply с текстом из 50 знаков: talking, через 1500+50·60 мс — idle, say и panel сохранены', () => {
    const say = 'а'.repeat(50);
    let model = fire(ready(0), { type: 'reply', reply: { say, show: PANEL } }, 1000);

    expect(model.state).toBe('talking');
    expect(model.say).toBe(say);
    expect(model.panel).toEqual(PANEL);

    model = onTick(model, 1000 + 4499, MODE_OFF);
    expect(model.state).toBe('talking');

    model = onTick(model, 1000 + 4500, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('reply с ask держит карточку ввода, следующий ответ её заменяет', () => {
    const ask = { title: 'Пришли текст', placeholder: 'заметки' };
    let model = fire(ready(0), { type: 'reply', reply: { say: 'Пришли заметки', ask } }, 1000);

    expect(model.state).toBe('talking');
    expect(model.ask).toEqual(ask);
    expect(model.panel).toBeUndefined();

    model = fire(model, { type: 'reply', reply: { say: 'Готово', show: PANEL } }, 1010);
    expect(model.ask).toBeUndefined();
    expect(model.panel).toEqual(PANEL);
  });

  it('reply с mood happy: сначала happy, затем talking', () => {
    let model = fire(ready(0), { type: 'reply', reply: { say: 'ура', mood: 'happy' } }, 1000);
    expect(model.state).toBe('happy');

    model = onTick(model, 1000 + 1500, MODE_OFF);
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
    let model = fire(ready(0), { type: 'reply', reply: { say: 'привет' } }, 1000);
    model = fire(model, { type: 'notify', title: 'событие' }, 1010);
    expect(model.state).toBe('talking');
    expect(model.queue).toContain('notify');

    model = onTick(model, 1000 + 1500 + 6 * 60, MODE_OFF);
    expect(model.state).toBe('notify');
  });

  it('error → confused → idle', () => {
    let model = fire(ready(0), { type: 'error', message: 'беда' }, 1000);
    expect(model.state).toBe('confused');

    model = onTick(model, 1000 + 1500, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('счётчик ответов растёт на каждом reply и держится при переходах', () => {
    let model = fire(ready(0), { type: 'reply', reply: { say: 'раз' } }, 1000);
    expect(model.replies).toBe(1);

    model = fire(model, { type: 'reply', reply: { say: 'два' } }, 1100);
    expect(model.replies).toBe(2);

    model = onTick(model, 10_000, MODE_OFF);
    expect(model.state).toBe('idle');
    expect(model.replies).toBe(2);
  });
});

describe('pet state: уход по тишине', () => {
  it('30 секунд idle при petMode false: leave, затем hidden, облачко и карточка очищены', () => {
    let model = fire(ready(0), { type: 'reply', reply: { say: 'привет', show: PANEL } }, 1000);
    const talkEnd = 1000 + 1500 + 6 * 60;
    model = onTick(model, talkEnd, MODE_OFF);
    expect(model.state).toBe('idle');

    model = onTick(model, talkEnd + 30000, MODE_OFF);
    expect(model.state).toBe('leave');

    model = onTick(model, talkEnd + 30900, MODE_OFF);
    expect(model.state).toBe('hidden');
    expect(model.say).toBeUndefined();
    expect(model.panel).toBeUndefined();
  });

  it('при petMode true ухода нет, через 5 минут — sleep, wake из sleep даёт appear', () => {
    let model = ready(0);
    expect(model.state).toBe('idle');

    model = onTick(model, 900 + 300000 - 1, MODE_ON);
    expect(model.state).toBe('idle');

    model = onTick(model, 900 + 300000, MODE_ON);
    expect(model.state).toBe('sleep');

    model = fire(model, { type: 'wake', source: 'click' }, 900 + 300000, MODE_ON);
    expect(model.state).toBe('appear');
  });

  it('при opts.busy отсчёт простоя не идёт', () => {
    let model = ready(0);
    model = onTick(model, 900 + 30001, { petMode: false, busy: true });
    expect(model.state).toBe('idle');

    model = onTick(model, 900 + 60001, { petMode: false, busy: true });
    expect(model.state).toBe('idle');

    model = onTick(model, 900 + 89999, { petMode: false, busy: false });
    expect(model.state).toBe('idle');

    model = onTick(model, 900 + 90001, { petMode: false, busy: false });
    expect(model.state).toBe('leave');
  });

  it('thinking дольше 90 секунд без событий → idle', () => {
    let model = fire(ready(0), { type: 'listen.end', text: 'привет' }, 1000);
    expect(model.state).toBe('thinking');

    model = onTick(model, 1000 + 89_999, MODE_OFF);
    expect(model.state).toBe('thinking');

    model = onTick(model, 1000 + 90_000, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('working дольше 90 секунд без событий → idle', () => {
    let model = fire(ready(0), { type: 'tool.start', tool: 't' }, 1000);
    expect(model.state).toBe('working');

    model = onTick(model, 1000 + 90_000, MODE_OFF);
    expect(model.state).toBe('idle');
  });

  it('новое событие сбрасывает отсчёт страховки', () => {
    let model = fire(ready(0), { type: 'tool.start', tool: 't' }, 0);
    model = fire(model, { type: 'tool.start', tool: 't' }, 89_000);
    expect(model.state).toBe('working');

    model = onTick(model, 90_000, MODE_OFF);
    expect(model.state).toBe('working');

    model = onTick(model, 179_000, MODE_OFF);
    expect(model.state).toBe('idle');
  });
});

describe('реплика из чата основного окна', () => {
  it('скрытый ёж не появляется и не показывает ответ', () => {
    let model = fire(initialPet(0), { type: 'listen.end', text: 'привет' }, 0, FROM_CHAT);
    expect(model.state).toBe('hidden');

    model = fire(model, { type: 'think.start' }, 1, FROM_CHAT);
    expect(model.state).toBe('hidden');

    model = fire(model, { type: 'reply', reply: { say: 'ответ', show: PANEL, ask: { title: 'ещё' } } }, 2, FROM_CHAT);
    expect(model.state).toBe('hidden');
    expect(model.say).toBeUndefined();
    expect(model.panel).toBeUndefined();
    expect(model.ask).toBeUndefined();
  });

  it('видимый ёж показывает только состояние, без облачка и карточки', () => {
    let model = fire(initialPet(0), { type: 'wake', source: 'click' }, 0);
    model = onTick(model, 900, MODE_OFF);
    expect(model.state).toBe('listening');

    model = fire(model, { type: 'listen.end', text: 'привет' }, 1000, FROM_CHAT);
    expect(model.state).toBe('thinking');

    model = fire(model, { type: 'reply', reply: { say: 'ответ', show: PANEL } }, 1001, FROM_CHAT);
    expect(model.state).toBe('talking');
    expect(model.say).toBeUndefined();
    expect(model.panel).toBeUndefined();
  });

  it('полоска с прежним текстом очищается при тихом ответе из чата', () => {
    let model = fire(initialPet(0), { type: 'wake', source: 'click' }, 0);
    model = onTick(model, 900, MODE_OFF);
    model = fire(model, { type: 'reply', reply: { say: 'первый ответ', show: PANEL } }, 1000);
    expect(model.say).toBe('первый ответ');

    model = fire(model, { type: 'reply', reply: { say: 'второй' } }, 1001, FROM_CHAT);
    expect(model.say).toBeUndefined();
    expect(model.panel).toBeUndefined();
  });

  it('реплика из строки ежа по-прежнему показывает облачко и карточку', () => {
    let model = fire(initialPet(0), { type: 'reply', reply: { say: 'ответ', show: PANEL } }, 0, { petMode: false, source: 'pet' });
    expect(model.state).toBe('appear');

    model = onTick(model, 900, MODE_OFF);
    expect(model.state).toBe('talking');
    expect(model.say).toBe('ответ');
    expect(model.panel).toEqual(PANEL);
  });

  it('уведомление по расписанию показывается у ежа, даже если до этого был тихий ответ', () => {
    let model = fire(initialPet(0), { type: 'reply', reply: { say: 'ответ' } }, 0, FROM_CHAT);
    expect(model.state).toBe('hidden');

    model = fire(model, { type: 'notify', title: 'Купить хлеб' }, 1);
    expect(model.state).toBe('appear');

    model = onTick(model, 901, MODE_OFF);
    expect(model.state).toBe('notify');
    expect(model.say).toBe('Купить хлеб');
  });
});

import type { Panel, TishkaEvent } from '../core/types';

export type PetState =
  | 'hidden'
  | 'appear'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'talking'
  | 'notify'
  | 'happy'
  | 'confused'
  | 'leave'
  | 'sleep';

export interface PetModel {
  state: PetState;
  since: number;                 // мс, когда вошли в состояние
  say?: string;                  // текст в облачке
  panel?: Panel;                 // карточка результата
  ask?: { title: string; placeholder?: string };   // карточка ввода
  queue: PetState[];             // состояния, которые нужно показать после текущего
  replies?: number;              // сколько раз приходил ответ; признак новой реплики
}

export interface PetOpts {
  petMode: boolean;
  busy?: boolean;                // открыта карточка или пользователь вводит текст
}

const APPEAR_MS = 900;
const LEAVE_MS = 900;
const MOOD_MS = 1500;
const TALK_BASE_MS = 1500;
const TALK_PER_CHAR_MS = 60;
const TALK_MAX_MS = 12000;
const IDLE_LEAVE_MS = 30000;
const IDLE_SLEEP_MS = 300000;
// thinking и working не могут длиться дольше: молчание фоновой проверки не должно
// навсегда оставлять Тишку «думающим».
const BUSY_LIMIT_MS = 90_000;

export function initialPet(now: number): PetModel {
  return { state: 'hidden', since: now, queue: [], replies: 0 };
}

function enter(model: PetModel, state: PetState, now: number, queue: PetState[] = []): PetModel {
  const next: PetModel = { state, since: now, queue, replies: model.replies ?? 0 };
  if (state !== 'hidden') {
    if (model.say !== undefined) {
      next.say = model.say;
    }
    if (model.panel !== undefined) {
      next.panel = model.panel;
    }
    if (model.ask !== undefined) {
      next.ask = model.ask;
    }
  }
  return next;
}

function advance(model: PetModel, now: number): PetModel {
  const [next, ...rest] = model.queue;
  if (next === undefined) {
    return enter(model, 'idle', now);
  }
  return enter(model, next, now, rest);
}

// Состояния, во время которых уведомление ждёт своей очереди, а не перебивает текущее.
const BUSY_STATES: PetState[] = ['appear', 'listening', 'thinking', 'working', 'talking', 'happy', 'confused'];

function isGone(model: PetModel): boolean {
  return model.state === 'hidden' || model.state === 'sleep';
}

// Любое событие, которое показывает ёжика, проходит через появление. Из скрытого
// состояния и сна — состояние appear с нужным следом; во время появления событие
// заменяет очередь, не срывая начатую анимацию. Так повод не важен: путь один.
function show(model: PetModel, target: PetState, now: number, rest: PetState[] = []): PetModel {
  if (model.state === 'appear') {
    return { ...model, queue: [target, ...rest] };
  }
  if (isGone(model)) {
    return enter(model, 'appear', now, [target, ...rest]);
  }
  return enter(model, target, now, rest);
}

export function onEvent(model: PetModel, event: TishkaEvent, now: number, opts: PetOpts): PetModel {
  void opts;
  switch (event.type) {
    case 'wake':
      return show(model, 'listening', now);
    case 'listen.start':
      return show(model, 'listening', now);
    case 'listen.end':
      return show(model, 'thinking', now);
    case 'think.start':
      return show(model, 'thinking', now);
    case 'tool.start':
      return show(model, 'working', now);
    case 'tool.end':
      return show(model, 'thinking', now);
    case 'status':
      return { ...model, say: event.text };
    case 'reply': {
      // Новый ответ заменяет прежнюю карточку: показывается либо результат, либо ввод.
      const base: PetModel = {
        // Во время появления не сбиваем его отсчёт — ответ встанет в очередь.
        since: model.state === 'appear' ? model.since : now,
        queue: [],
        say: event.reply.say,
        state: model.state,
        replies: (model.replies ?? 0) + 1
      };
      if (event.reply.show !== undefined) {
        base.panel = event.reply.show;
      }
      if (event.reply.ask !== undefined) {
        base.ask = event.reply.ask;
      }
      if (event.reply.mood === 'happy') {
        return show(base, 'happy', now, ['talking']);
      }
      if (event.reply.mood === 'confused') {
        return show(base, 'confused', now, ['talking']);
      }
      return show(base, 'talking', now);
    }
    case 'speak.start':
      return show(model, 'talking', now);
    case 'speak.end':
      return isGone(model) ? model : enter(model, 'idle', now);
    case 'notify': {
      if (BUSY_STATES.includes(model.state)) {
        return { ...model, queue: [...model.queue, 'notify'] };
      }
      const base: PetModel = { ...model, say: event.title };
      return show(base, 'notify', now);
    }
    case 'skill.saved':
      return event.source === 'dialog' ? show(model, 'happy', now, ['idle']) : model;
    case 'error':
      return show(model, 'confused', now);
    case 'idle':
      // Простой вне разговора не поднимает окно: скрытый ёж остаётся скрытым.
      return isGone(model) || model.state === 'talking' ? model : enter(model, 'idle', now);
    default:
      return model;
  }
}

function talkingDuration(say: string | undefined): number {
  const length = say === undefined ? 0 : say.length;
  return Math.min(TALK_MAX_MS, TALK_BASE_MS + length * TALK_PER_CHAR_MS);
}

export function onTick(model: PetModel, now: number, opts: PetOpts): PetModel {
  const elapsed = now - model.since;
  switch (model.state) {
    case 'appear':
      return elapsed >= APPEAR_MS ? advance(model, now) : model;
    case 'leave':
      return elapsed >= LEAVE_MS ? enter(model, 'hidden', now) : model;
    case 'happy':
    case 'confused':
    case 'notify':
      return elapsed >= MOOD_MS ? advance(model, now) : model;
    case 'talking':
      return elapsed >= talkingDuration(model.say) ? advance(model, now) : model;
    case 'thinking':
    case 'working':
      return elapsed >= BUSY_LIMIT_MS ? enter(model, 'idle', now) : model;
    case 'idle': {
      // Пока открыта карточка или идёт ввод, простой не отсчитывается.
      if (opts.busy === true) {
        return model.since === now ? model : { ...model, since: now };
      }
      if (opts.petMode) {
        return elapsed >= IDLE_SLEEP_MS ? enter(model, 'sleep', now) : model;
      }
      return elapsed >= IDLE_LEAVE_MS ? enter(model, 'leave', now) : model;
    }
    default:
      return model;
  }
}

import type { Panel, TishkaEvent } from '../core/types';
import { greetingFor } from '../voice/canned';

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
  confirm?: { id: string; text: string };          // вопрос подтверждения с кнопками
  queue: PetState[];             // состояния, которые нужно показать после текущего
  replies?: number;              // сколько раз приходил ответ; признак новой реплики
  leaving?: boolean;             // уход отложен: сначала договорить текущий ответ
  greeting?: boolean;            // показываем приветствие: облачко и подпись согласованы
}

export type TalkSource = 'chat' | 'pet';

export interface PetOpts {
  petMode: boolean;
  busy?: boolean;                // открыта карточка или пользователь вводит текст
  source?: TalkSource;           // 'chat' — реплика из окна чата основного окна
  ready?: boolean;               // служба распознавания готова: выбор приветствия
  idleLeaveMs?: number;          // сколько ждать простоя перед уходом; нет — IDLE_LEAVE_MS
}

function isQuiet(opts: PetOpts): boolean {
  return opts.source === 'chat';
}

function isAway(model: PetModel): boolean {
  return model.state === 'hidden' || model.state === 'sleep';
}

const APPEAR_MS = 900;
const LEAVE_MS = 900;
const MOOD_MS = 1500;
const TALK_BASE_MS = 1500;
const TALK_PER_CHAR_MS = 60;
const TALK_MAX_MS = 12000;
const IDLE_LEAVE_MS = 90_000;
const IDLE_SLEEP_MS = 300000;
// thinking и working не могут длиться дольше: молчание проверки не оставит Тишку «думающим».
const BUSY_LIMIT_MS = 90_000;
const REPLY_STATES: PetState[] = ['talking', 'happy', 'confused'];

export function initialPet(now: number): PetModel {
  return { state: 'hidden', since: now, queue: [], replies: 0 };
}

function enter(model: PetModel, state: PetState, now: number, queue: PetState[] = []): PetModel {
  const next: PetModel = { state, since: now, queue, replies: model.replies ?? 0 };
  if (state !== 'hidden') {
    if (model.say !== undefined) next.say = model.say;
    if (model.panel !== undefined) next.panel = model.panel;
    if (model.ask !== undefined) next.ask = model.ask;
    if (model.confirm !== undefined) next.confirm = model.confirm;
    if (model.greeting === true && (state === 'appear' || state === 'listening')) next.greeting = true;
  }
  if (model.leaving === true && state !== 'leave') next.leaving = true;
  return next;
}

// Куда идти, когда состояние доиграло: в отложенный уход или в простой.
function settle(model: PetModel, now: number): PetModel {
  return enter(model, model.leaving === true ? 'leave' : 'idle', now);
}

function advance(model: PetModel, now: number): PetModel {
  const [next, ...rest] = model.queue;
  return next === undefined ? settle(model, now) : enter(model, next, now, rest);
}

// Просьба уйти: пока ёж показывает или договаривает ответ, уход ждёт конца реплики.
export function requestLeave(model: PetModel, now: number): PetModel {
  if (isAway(model)) return model;
  const showing =
    REPLY_STATES.includes(model.state) ||
    (model.state === 'appear' && model.say !== undefined && model.greeting !== true);
  if (showing) return { ...model, leaving: true };
  // Приветствие не ответ: уход его не дожидается, облачко очищается.
  return enter(endGreeting(model), 'leave', now);
}

// Состояния, во время которых уведомление ждёт своей очереди, а не перебивает текущее.
const BUSY_STATES: PetState[] = ['appear', 'listening', 'thinking', 'working', 'talking', 'happy', 'confused'];

// Любое показывающее событие проходит через появление.
function show(model: PetModel, target: PetState, now: number, rest: PetState[] = []): PetModel {
  if (model.state === 'appear') return { ...model, queue: [target, ...rest] };
  if (isAway(model)) return enter(model, 'appear', now, [target, ...rest]);
  return enter(model, target, now, rest);
}

// Конец приветствия: облачко и подпись снова про запись, а не про сказанное.
function endGreeting(model: PetModel): PetModel {
  return model.greeting === true ? { ...model, greeting: undefined, say: undefined } : model;
}

export function onEvent(model: PetModel, event: TishkaEvent, now: number, opts: PetOpts): PetModel {
  const quiet = isQuiet(opts);
  switch (event.type) {
    case 'wake': {
      // Новый вызов отменяет отложенный уход.
      const base = { ...model, leaving: false };
      if (event.source === 'trigger') {
        return show(base, 'listening', now);
      }
      // Пока звучит приветствие, в облачке ровно тот же текст, что и вслух.
      return show({ ...base, say: greetingFor(opts.ready !== false), greeting: true }, 'listening', now);
    }
    case 'listen.start':
      return show({ ...model, leaving: false }, 'listening', now);
    case 'listen.end':
      return quiet && isAway(model) ? model : show(endGreeting(model), 'thinking', now);
    case 'think.start':
      // Планшет MCP/сайта не сбрасываем, пока идут инструменты.
      if (model.state === 'working') {
        return model;
      }
      return quiet && isAway(model) ? model : show(endGreeting(model), 'thinking', now);
    case 'tool.start':
      return quiet && isAway(model) ? model : show(endGreeting(model), 'working', now);
    case 'tool.end':
      return quiet && isAway(model) ? model : model.state === 'working' ? model : show(endGreeting(model), 'thinking', now);
    case 'status':
      // Статус из окна чата ежу не показываем: эта строка живёт только в ленте
      // чата. Статус от самого ежа по-прежнему ложится в облачко.
      return quiet ? model : { ...endGreeting(model), say: event.text };
    case 'confirm.request': {
      const confirm = { id: event.id, text: event.text };
      return quiet && isAway(model) ? { ...model, confirm } : { ...endGreeting(model), say: event.text, confirm };
    }
    case 'confirm.close':
      return model.confirm?.id === event.id ? { ...model, confirm: undefined } : model;
    case 'reply': {
      if (quiet) {
        const replies = (model.replies ?? 0) + 1;
        if (isAway(model)) return { ...model, replies };
        // Без облачка и карточки — только смена состояния.
        return enter({ since: now, queue: [], state: model.state, replies, leaving: model.leaving }, 'talking', now);
      }
      // Новый ответ заменяет прежнюю карточку: результат либо ввод.
      const base: PetModel = {
        since: model.state === 'appear' ? model.since : now,
        queue: [],
        say: event.reply.say,
        state: model.state,
        replies: (model.replies ?? 0) + 1,
        leaving: model.leaving
      };
      if (event.reply.show !== undefined) base.panel = event.reply.show;
      if (event.reply.ask !== undefined) base.ask = event.reply.ask;
      if (event.reply.mood === 'happy') return show(base, 'happy', now, ['talking']);
      if (event.reply.mood === 'confused') return show(base, 'confused', now, ['talking']);
      return show(base, 'talking', now);
    }
    case 'speak.start':
      // Приветствие уже показано вместе с вызовом: состояние не меняем.
      if (model.greeting === true) return model;
      return quiet && isAway(model) ? model : show(model, 'talking', now);
    case 'speak.end':
      // Конец приветствия: облачко гаснет, подпись снова про запись.
      if (model.greeting === true) return endGreeting(model);
      return isAway(model) ? model : settle(model, now);
    case 'notify': {
      const base = endGreeting(model);
      if (BUSY_STATES.includes(base.state)) return { ...base, queue: [...base.queue, 'notify'] };
      return show({ ...base, say: event.title }, 'notify', now);
    }
    case 'skill.saved':
      return event.source === 'dialog' ? show(model, 'happy', now, ['idle']) : model;
    case 'error':
      return quiet && isAway(model) ? model : show(endGreeting(model), 'confused', now);
    case 'idle':
      // Простой вне разговора не поднимает скрытого ежа.
      return isAway(model) || model.state === 'talking' ? model : settle(model, now);
    default:
      return model;
  }
}

function talkingDuration(say: string | undefined): number {
  return Math.min(TALK_MAX_MS, TALK_BASE_MS + (say?.length ?? 0) * TALK_PER_CHAR_MS);
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
    case 'listening':
      // Речь выключена: приветствие держим столько, сколько звучало бы.
      return model.greeting === true && elapsed >= talkingDuration(model.say) ? endGreeting(model) : model;
    case 'idle': {
      // Пока открыта карточка или идёт ввод, простой не отсчитывается.
      if (opts.busy === true) return model.since === now ? model : { ...model, since: now };
      if (model.leaving === true) return enter(model, 'leave', now);
      if (opts.petMode) return elapsed >= IDLE_SLEEP_MS ? enter(model, 'sleep', now) : model;
      const leaveMs = opts.idleLeaveMs !== undefined && opts.idleLeaveMs > 0 ? opts.idleLeaveMs : IDLE_LEAVE_MS;
      return elapsed >= leaveMs ? enter(model, 'leave', now) : model;
    }
    default:
      return model;
  }
}

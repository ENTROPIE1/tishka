// Эмоции поверх клипа, как в образце модели: действие → эмоция → сценка → рот речи.
// Эмоция меняет части лица и значки эмоции, плавно ставит уши, наклон головы и брови;
// сценка добавляет к костям свои ключи и меняет лицо по времени. Модуль не зависит от DOM.

import type { RigEmote, RigEmotion, RigModel, RigShow } from './rig-data';
import { clonePose, keyAt, type PoseState } from './rig-pose';

export const FACE_KEYS = ['eyes', 'eyeShape', 'iris', 'brows', 'mouth'] as const;

// Скорость, с которой уши, голова и брови подходят к позе эмоции (доля за секунду).
export const EMOTION_EASE = 8;
const MAX_STEP_S = 0.05;

type EmotionData = Required<Pick<RigModel, 'emotions' | 'emotes' | 'emotionFx'>>;

interface Offsets {
  ear_l: number;
  ear_r: number;
  head: number;
  headY: number;
  browY: number;
}

function targetOffsets(emotion: RigEmotion | null): Offsets {
  return {
    ear_l: emotion?.ears[0] ?? 0,
    ear_r: emotion?.ears[1] ?? 0,
    head: emotion?.head[0] ?? 0,
    headY: emotion?.head[1] ?? 0,
    browY: emotion?.browY ?? 0
  };
}

export type MoodAction =
  | { kind: 'reset' }
  | { kind: 'emote'; name: string }
  | { kind: 'emotion'; name: string }
  | { kind: 'legacy' };

// Что делать с именем из setMood. neutral — лицо по клипу и конец сценки; имя сценки
// проигрывает её; эмоция ставится (и снимает повторяемую сценку) по имени или по настроению ответа (MOOD_EMOTION).
// Модель без emotions.js и незнакомое имя — прежний набор лица из MOODS.
export function resolveMood(model: Pick<RigModel, 'emotions' | 'emotes' | 'moodEmotion'>, name: string): MoodAction {
  const emotions = model.emotions ?? {};
  if (Object.keys(emotions).length === 0) {
    return { kind: 'legacy' };
  }
  if (name === 'neutral') {
    return { kind: 'reset' };
  }
  if (model.emotes?.[name] !== undefined) {
    return { kind: 'emote', name };
  }
  const target = emotions[name] !== undefined ? name : model.moodEmotion?.[name];
  return target !== undefined && emotions[target] !== undefined ? { kind: 'emotion', name: target } : { kind: 'legacy' };
}

export class RigEmotionState {
  private name: string | null = null;
  private emote: { name: string; data: RigEmote; t0: number } | null = null;
  private emoteT = 0;
  private cur: Offsets = targetOffsets(null);
  private last: number | null = null;

  constructor(private readonly data: EmotionData) {}

  get emotion(): string | null {
    return this.name;
  }

  get emoteName(): string | null {
    return this.emote?.name ?? null;
  }

  // null — лицо по клипу («по действию»).
  setEmotion(name: string | null): boolean {
    if (name !== null && this.data.emotions[name] === undefined) {
      return false;
    }
    this.name = name;
    return true;
  }

  playEmote(name: string, now: number): boolean {
    const data = this.data.emotes[name];
    if (data === undefined) {
      return false;
    }
    this.emote = { name, data, t0: now };
    this.emoteT = 0;
    return true;
  }

  stopEmote(): void {
    this.emote = null;
  }

  // Повторяемая сценка (плачет, хохочет…) сама не кончается: её снимает новая эмоция.
  stopLoopingEmote(): void {
    if (this.emote?.data.loop === true) {
      this.emote = null;
    }
  }

  // Шаг кадра: уши, голова и брови подтягиваются к эмоции, неповторяемая сценка кончается.
  step(now: number): void {
    const dt = this.last === null ? 0.016 : Math.min(MAX_STEP_S, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const target = targetOffsets(this.current());
    const k = Math.min(1, dt * EMOTION_EASE);
    for (const key of Object.keys(this.cur) as (keyof Offsets)[]) {
      this.cur[key] += (target[key] - this.cur[key]) * k;
    }
    if (this.emote !== null) {
      const t = (now - this.emote.t0) / 1000;
      const { len, loop } = this.emote.data;
      if (loop !== true && t >= len) {
        this.emote = null;
      } else {
        this.emoteT = loop === true ? t % len : t;
      }
    }
  }

  // Лицо: части лица эмоции вместо клиповых (кроме закрытых клипом глаз — сон),
  // значки эмоции заменяют прежние значки эмоции, значки действия остаются.
  face(show: RigShow): RigShow {
    const out: RigShow = { ...show };
    const fx = new Set(show.fx);
    const emotion = this.current();
    if (emotion !== null) {
      for (const key of FACE_KEYS) {
        const value = emotion[key];
        if (value !== undefined && !(key === 'eyes' && show.eyes === 'closed')) {
          (out as unknown as Record<string, unknown>)[key] = value;
        }
      }
      for (const name of this.data.emotionFx) {
        fx.delete(name);
      }
      for (const name of emotion.fx ?? []) {
        fx.add(name);
      }
    }
    if (this.emote !== null) {
      for (const [at, patch] of this.emote.data.face) {
        if (at <= this.emoteT) {
          Object.assign(out, patch);
        }
      }
      for (const name of this.emote.data.fx) {
        fx.add(name);
      }
    }
    out.fx = [...fx];
    return out;
  }

  // Поза клипа плюс добавки эмоции и сценки: повороты и сдвиги складываются.
  pose(base: PoseState): PoseState {
    const pose = clonePose(base);
    const add = (id: string, r: number, x: number, y: number): void => {
      if (r === 0 && x === 0 && y === 0) {
        return;
      }
      pose.rot[id] = (pose.rot[id] ?? 0) + r;
      const t = pose.trans[id] ?? { x: 0, y: 0, s: 1 };
      pose.trans[id] = { x: t.x + x, y: t.y + y, s: t.s };
    };
    add('ear_l', this.cur.ear_l, 0, 0);
    add('ear_r', this.cur.ear_r, 0, 0);
    add('head', this.cur.head, 0, this.cur.headY);
    add('brow_l', 0, 0, this.cur.browY);
    add('brow_r', 0, 0, this.cur.browY);
    if (this.emote !== null) {
      for (const [id, keys] of Object.entries(this.emote.data.bones)) {
        const [r, x, y] = keyAt(keys, this.emoteT);
        add(id, r, x, y);
      }
    }
    return pose;
  }

  private current(): RigEmotion | null {
    return this.name === null ? null : (this.data.emotions[this.name] ?? null);
  }
}

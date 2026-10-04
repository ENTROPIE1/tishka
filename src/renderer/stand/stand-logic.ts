import type { PetState } from '../../pet/state';
import type { ClipName } from '../pet/character';

export const SCRIPT_STEP_MS = 2000;

export const SCRIPT_STATE_ORDER: PetState[] = [
  'appear',
  'idle',
  'listening',
  'thinking',
  'working',
  'talking',
  'happy',
  'idle',
  'leave'
];

// Клипы, без которых персонаж не проживёт основные состояния окна-питомца.
export const REQUIRED_CLIPS: ClipName[] = ['idle', 'walk', 'listen', 'talk'];

export const SPEECH_MIN_HZ = 4;
export const SPEECH_MAX_HZ = 6;

export const STATE_LABELS: Record<PetState, string> = {
  hidden: 'спрятан',
  appear: 'выходит',
  idle: 'ждёт',
  listening: 'слушает',
  thinking: 'думает',
  working: 'работает',
  talking: 'говорит',
  notify: 'замечает',
  happy: 'радуется',
  confused: 'не понял',
  leave: 'уходит',
  sleep: 'спит'
};

export interface ScriptStep {
  state: PetState;
  label: string;
  durationMs: number;
}

export function scriptSteps(): ScriptStep[] {
  return SCRIPT_STATE_ORDER.map((state) => ({
    state,
    label: STATE_LABELS[state],
    durationMs: SCRIPT_STEP_MS
  }));
}

export function missingClips(available: readonly ClipName[]): ClipName[] {
  const have = new Set(available);
  return REQUIRED_CLIPS.filter((clip) => !have.has(clip));
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

const TAU = Math.PI * 2;

// Уровень рта: синусоида 4–6 раз в секунду плюс шум, всегда в диапазоне 0–1.
export function speechLevel(nowMs: number, random: () => number = Math.random): number {
  const hz = SPEECH_MIN_HZ + random() * (SPEECH_MAX_HZ - SPEECH_MIN_HZ);
  const wave = 0.5 + 0.5 * Math.sin((nowMs / 1000) * hz * TAU);
  const noise = (random() - 0.5) * 0.2;
  return clamp01(wave + noise);
}

export interface ScriptPlayer {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export interface ScriptPlayerDeps {
  steps: readonly ScriptStep[];
  onStep(step: ScriptStep, index: number): void;
  onFinish(): void;
}

export function createScriptPlayer(deps: ScriptPlayerDeps): ScriptPlayer {
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  function step(): void {
    const current = deps.steps[index];
    deps.onStep(current, index);
    timer = setTimeout(() => {
      index += 1;
      if (index >= deps.steps.length) {
        running = false;
        deps.onFinish();
        return;
      }
      step();
    }, current.durationMs);
  }

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      index = 0;
      if (deps.steps.length === 0) {
        running = false;
        deps.onFinish();
        return;
      }
      step();
    },
    stop(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      running = false;
    },
    isRunning(): boolean {
      return running;
    }
  };
}

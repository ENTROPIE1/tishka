import type { PetState } from '../../pet/state';
import { clipForState, type Character, type ClipName } from '../pet/character';
import { CHARACTER_SOURCES, createCharacter } from '../pet/character-factory';
import { RigPlayer } from '../character-rig/rig-player';
import { browList, eyeShapeList, handList, irisList, mouthList } from '../character-rig/rig-variants';
import { installLinkGuard } from '../shared/links';
import { createScriptPlayer, missingClips, scriptSteps, speechLevel, STATE_LABELS, type ScriptPlayer } from './stand-logic';

const TALK_TICK_MS = 90;
const BACKGROUNDS = ['bg-light', 'bg-dark', 'bg-checker', 'bg-desktop'];
const STAND_STATES: PetState[] = ['appear', 'idle', 'listening', 'thinking', 'working', 'talking', 'notify', 'happy', 'confused', 'sleep', 'leave'];
const RIG_KIND = 'rig';
const SVG_LABEL = 'Первый ёж';
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const stage = $('stage'), scene = $('character'), frame = $('frame'), source = $<HTMLSelectElement>('source');
const reload = $<HTMLButtonElement>('reload'), clipsHost = $('clips'), mouth = $<HTMLInputElement>('mouth');
const mouthValue = $('mouth-value'), talk = $<HTMLButtonElement>('talk'), flipBox = $<HTMLInputElement>('flip');
const bgHost = $('backgrounds'), scale = $<HTMLInputElement>('scale'), scaleValue = $('scale-value');
const frameToggle = $<HTMLInputElement>('show-frame'), statesHost = $('states'), scriptLabel = $('script-step');
const play = $<HTMLButtonElement>('play'), stop = $<HTMLButtonElement>('stop'), info = $('info');
const rigPanel = $('rig-panel'), rigEyes = $<HTMLSelectElement>('rig-eyes'), rigIris = $<HTMLSelectElement>('rig-iris');
const rigBrows = $<HTMLSelectElement>('rig-brows'), rigMouth = $<HTMLSelectElement>('rig-mouth');
const rigHandL = $<HTMLSelectElement>('rig-hand-l'), rigHandR = $<HTMLSelectElement>('rig-hand-r'), rigFxHost = $('rig-fx');

let character: Character | undefined;
let rig: RigPlayer | undefined;
let talkTimer: number | undefined;
let loadMs = 0;
let loadError = '';
let player: ScriptPlayer | undefined;
const clipButtons = new Map<string, HTMLButtonElement>();
const rigFx = new Set<string>();

function stopTalk(): void {
  if (talkTimer !== undefined) {
    window.clearInterval(talkTimer);
    talkTimer = undefined;
  }
  talk.classList.remove('is-active');
}

function rigMouthShape(level: number): string | null {
  if (level < 0.05) {
    return null;
  }
  return level < 0.5 ? 'm_teeth' : 'm_a';
}

function setMouth(level: number): void {
  mouth.value = level.toFixed(2);
  mouthValue.textContent = level.toFixed(2);
  if (rig !== undefined) {
    rig.setMouth(rigMouthShape(level));
  } else {
    character?.setMouth(level);
  }
}

function startTalk(): void {
  stopTalk();
  talk.classList.add('is-active');
  talkTimer = window.setInterval(() => setMouth(speechLevel(Date.now())), TALK_TICK_MS);
}

function applyClip(name: string): void {
  for (const [clip, button] of clipButtons) {
    button.classList.toggle('is-active', clip === name);
  }
  rig?.play(name);
  character?.setClip(name as ClipName);
}

function setFlip(flipped: boolean): void {
  flipBox.checked = flipped;
  rig?.setFlip(flipped);
  character?.setFlip(flipped);
}

function makeButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function buildClips(available: readonly string[]): void {
  clipsHost.replaceChildren();
  clipButtons.clear();
  for (const name of available) {
    const button = makeButton(name, 'clip-button', () => {
      stopTalk();
      applyClip(name);
    });
    clipButtons.set(name, button);
    clipsHost.append(button);
  }
}

function buildStates(): void {
  statesHost.replaceChildren();
  for (const state of STAND_STATES) {
    statesHost.append(makeButton(STATE_LABELS[state], 'state-button', () => {
      stopTalk();
      const { clip, flip } = clipForState(state);
      setFlip(flip);
      applyClip(clip);
      scriptLabel.textContent = STATE_LABELS[state];
    }));
  }
}

function fillSelect(select: HTMLSelectElement, values: readonly string[], current: string): void {
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.value = current;
}

function buildRigFx(values: readonly string[], list: readonly string[]): void {
  rigFxHost.replaceChildren();
  for (const name of values) {
    const on = list.includes(name);
    if (on) {
      rigFx.add(name);
    }
    const button = makeButton(name, on ? 'clip-button is-active' : 'clip-button', () => {
      if (rigFx.has(name)) {
        rigFx.delete(name);
      } else {
        rigFx.add(name);
      }
      rig?.setShow({ fx: [...rigFx] });
      button.classList.toggle('is-active', rigFx.has(name));
    });
    rigFxHost.append(button);
  }
}

function configureRig(instance: RigPlayer): void {
  const model = instance.data;
  if (model === null) {
    return;
  }
  const show = model.show;
  fillSelect(rigEyes, eyeShapeList(model), show.eyeShape);
  fillSelect(rigIris, irisList(model), show.iris);
  fillSelect(rigBrows, browList(model), show.brows);
  fillSelect(rigMouth, ['', ...mouthList(model)], '');
  fillSelect(rigHandL, handList(model), show.hand_l);
  fillSelect(rigHandR, handList(model), show.hand_r);
  rigFx.clear();
  buildRigFx(model.fx, show.fx);
}

function availableClips(): string[] {
  if (rig !== undefined) {
    return rig.clips();
  }
  return character?.clips() ?? [];
}

function renderInfo(): void {
  const available = availableClips();
  const missing = missingClips(available as ClipName[]);
  info.textContent = [
    `Источник: ${source.selectedOptions[0]?.textContent ?? '—'}`,
    `Клипы: ${available.join(', ') || '—'}`,
    `Не хватает обязательных: ${missing.join(', ') || 'нет'}`,
    `Загрузка: ${loadMs.toFixed(0)} мс`,
    `Ошибки: ${loadError || 'нет'}`
  ].join('\n');
}

async function mountCharacter(): Promise<void> {
  stopTalk();
  player?.stop();
  scriptLabel.textContent = '';
  character?.dispose();
  rig?.dispose();
  character = undefined;
  rig = undefined;
  scene.replaceChildren();
  loadError = '';
  const kind = source.value;
  const started = performance.now();
  if (kind === RIG_KIND) {
    const instance = new RigPlayer();
    try {
      await instance.load();
      await instance.mount(scene);
      rig = instance;
      configureRig(instance);
    } catch (error: unknown) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  } else {
    character = createCharacter(kind);
    try {
      await character.mount(scene);
    } catch (error: unknown) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  }
  loadMs = performance.now() - started;
  rigPanel.hidden = kind !== RIG_KIND;
  buildClips(availableClips());
  applyClip('idle');
  setFlip(flipBox.checked);
  renderInfo();
}

function initControls(): void {
  source.addEventListener('change', () => void mountCharacter());
  reload.addEventListener('click', () => void mountCharacter());
  mouth.addEventListener('input', () => {
    stopTalk();
    setMouth(Number(mouth.value));
  });
  talk.addEventListener('click', () => {
    if (talkTimer !== undefined) {
      stopTalk();
      setMouth(Number(mouth.value));
    } else {
      startTalk();
    }
  });
  flipBox.addEventListener('change', () => setFlip(flipBox.checked));
  rigEyes.addEventListener('change', () => rig?.setShow({ eyeShape: rigEyes.value }));
  rigIris.addEventListener('change', () => rig?.setShow({ iris: rigIris.value }));
  rigBrows.addEventListener('change', () => rig?.setShow({ brows: rigBrows.value }));
  rigMouth.addEventListener('change', () => rig?.setMouth(rigMouth.value === '' ? null : rigMouth.value));
  rigHandL.addEventListener('change', () => rig?.setShow({ hand_l: rigHandL.value }));
  rigHandR.addEventListener('change', () => rig?.setShow({ hand_r: rigHandR.value }));
  bgHost.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    const bg = target.dataset['bg'];
    if (bg === undefined) {
      return;
    }
    stage.classList.remove(...BACKGROUNDS);
    stage.classList.add(bg);
  });
  scale.addEventListener('input', () => {
    const value = Number(scale.value);
    scaleValue.textContent = `${value} %`;
    stage.style.setProperty('--stage-scale', String(value / 100));
  });
  frameToggle.addEventListener('change', () => {
    frame.hidden = !frameToggle.checked;
  });
}

function finishScript(label: string): void {
  stopTalk();
  scriptLabel.textContent = label;
  play.disabled = false;
  stop.disabled = true;
}

function initScript(): void {
  player = createScriptPlayer({
    steps: scriptSteps(),
    onStep: (step) => {
      const { clip, flip } = clipForState(step.state);
      setFlip(flip);
      applyClip(clip);
      scriptLabel.textContent = STATE_LABELS[step.state];
      if (step.state === 'talking') {
        startTalk();
      }
    },
    onFinish: () => finishScript('готово')
  });
  play.addEventListener('click', () => {
    play.disabled = true;
    stop.disabled = false;
    player?.start();
  });
  stop.addEventListener('click', () => {
    player?.stop();
    finishScript('остановлено');
  });
}

for (const item of CHARACTER_SOURCES) {
  const option = document.createElement('option');
  option.value = item.kind;
  option.textContent = item.kind === 'svg' ? SVG_LABEL : item.label;
  source.append(option);
}
const rigOption = document.createElement('option');
rigOption.value = RIG_KIND;
rigOption.textContent = 'Тишка';
source.append(rigOption);
buildStates();
initControls();
initScript();
installLinkGuard(document);
void mountCharacter();

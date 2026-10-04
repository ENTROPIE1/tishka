import type { PetState } from '../../pet/state';
import { CLIP_NAMES, clipForState, type Character, type ClipName } from '../pet/character';
import { CHARACTER_SOURCES, createCharacter } from '../pet/character-factory';
import { createScriptPlayer, missingClips, scriptSteps, speechLevel, STATE_LABELS, type ScriptPlayer } from './stand-logic';

const TALK_TICK_MS = 90;
const BACKGROUNDS = ['bg-light', 'bg-dark', 'bg-checker', 'bg-desktop'];
const STAND_STATES: PetState[] = ['appear', 'idle', 'listening', 'thinking', 'working', 'talking', 'notify', 'happy', 'confused', 'sleep', 'leave'];
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const stage = $('stage'), scene = $('character'), frame = $('frame'), source = $<HTMLSelectElement>('source');
const reload = $<HTMLButtonElement>('reload'), clipsHost = $('clips'), mouth = $<HTMLInputElement>('mouth');
const mouthValue = $('mouth-value'), talk = $<HTMLButtonElement>('talk'), flipBox = $<HTMLInputElement>('flip');
const bgHost = $('backgrounds'), scale = $<HTMLInputElement>('scale'), scaleValue = $('scale-value');
const frameToggle = $<HTMLInputElement>('show-frame'), statesHost = $('states'), scriptLabel = $('script-step');
const play = $<HTMLButtonElement>('play'), stop = $<HTMLButtonElement>('stop'), info = $('info');

let character: Character | undefined;
let talkTimer: number | undefined;
let loadMs = 0;
let loadError = '';
let player: ScriptPlayer | undefined;
const clipButtons = new Map<ClipName, HTMLButtonElement>();

function stopTalk(): void {
  if (talkTimer !== undefined) { window.clearInterval(talkTimer); talkTimer = undefined; }
  talk.classList.remove('is-active');
}

function setMouth(level: number): void {
  mouth.value = level.toFixed(2);
  mouthValue.textContent = level.toFixed(2);
  character?.setMouth(level);
}

function startTalk(): void {
  stopTalk();
  talk.classList.add('is-active');
  talkTimer = window.setInterval(() => setMouth(speechLevel(Date.now())), TALK_TICK_MS);
}

function applyClip(name: ClipName): void {
  for (const [clip, button] of clipButtons) {
    button.classList.toggle('is-active', clip === name);
  }
  character?.setClip(name);
}

function makeButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function buildClips(available: readonly ClipName[]): void {
  clipsHost.replaceChildren();
  clipButtons.clear();
  const have = new Set(available);
  for (const name of CLIP_NAMES) {
    const button = makeButton(name, 'clip-button', () => {
      stopTalk();
      applyClip(name);
    });
    if (!have.has(name)) {
      button.disabled = true;
      button.classList.add('is-missing');
      button.title = 'нет в файле';
      button.textContent = `${name} — нет в файле`;
    }
    clipButtons.set(name, button);
    clipsHost.append(button);
  }
}

function selectState(state: PetState): void {
  stopTalk();
  const { clip, flip } = clipForState(state);
  flipBox.checked = flip;
  character?.setFlip(flip);
  applyClip(clip);
  scriptLabel.textContent = STATE_LABELS[state];
}

function buildStates(): void {
  statesHost.replaceChildren();
  for (const state of STAND_STATES) {
    statesHost.append(makeButton(STATE_LABELS[state], 'state-button', () => selectState(state)));
  }
}

function renderInfo(): void {
  const available = character?.clips() ?? [];
  const missing = missingClips(available);
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
  scene.replaceChildren();
  character = createCharacter(source.value);
  const started = performance.now();
  try {
    await character.mount(scene);
    loadError = '';
  } catch (error: unknown) {
    loadError = error instanceof Error ? error.message : String(error);
  }
  loadMs = performance.now() - started;
  buildClips(character.clips());
  applyClip('idle');
  character.setFlip(flipBox.checked);
  renderInfo();
}

function initControls(): void {
  source.addEventListener('change', () => void mountCharacter());
  reload.addEventListener('click', () => void mountCharacter());
  mouth.addEventListener('input', () => { stopTalk(); setMouth(Number(mouth.value)); });
  talk.addEventListener('click', () => {
    if (talkTimer !== undefined) {
      stopTalk();
      setMouth(Number(mouth.value));
    } else {
      startTalk();
    }
  });
  flipBox.addEventListener('change', () => character?.setFlip(flipBox.checked));
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
  frameToggle.addEventListener('change', () => { frame.hidden = !frameToggle.checked; });
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
      selectState(step.state);
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
  option.textContent = item.label;
  source.append(option);
}
buildStates();
initControls();
initScript();
void mountCharacter();

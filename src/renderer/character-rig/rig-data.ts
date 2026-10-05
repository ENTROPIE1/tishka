// Типы данных костной модели Тишки и сборка одного model.json из исходников модели.
// Модуль не зависит от DOM: исходники приходят строками, результат — обычный объект.

export interface RigBone {
  id: string;
  parent: string | null;
  pivot: [number, number];
  label: string;
}

export interface HandSpec {
  x: number;
  y: number;
  rot: number;
  scale: number;
  flip: boolean;
}

export interface RigLayer {
  id: string;
  src: string;
  bone: string;
  dx?: number;
  dy?: number;
  group?: string;
  variant?: string;
  hand?: HandSpec;
  eyePart?: 'white' | 'iris' | 'hl' | 'line';
  side?: 'l' | 'r';
  shape?: string;
  iris?: string;
  lid?: string;
  fxName?: string;
  fxSet?: number;
  headphones?: boolean;
  buds?: boolean;
  glow?: boolean;
  ball?: boolean;
}

export interface RigMask {
  w: number;
  h: number;
  x: number;
  y: number;
  gw: number;
  gh: number;
  b: string;
}

export interface ArmFrontRule {
  enabled: boolean;
  zone: string;
  above: string;
}

export interface RigShow {
  eyes: 'open' | 'closed';
  eyeShape: string;
  iris: string;
  mouth: string;
  brows: string;
  hand_l: string;
  hand_r: string;
  fx: string[];
  fxSet: number;
  headphones: boolean;
  tablet: string;
  glow: boolean;
  wink?: 'l' | 'r';
  ball?: boolean;
}

// Ключ: [время, поворот, сдвиг x, сдвиг y, растяжение по высоте]; хвост необязателен.
export type ClipKey = number[];

export interface RigClip {
  len: number;
  loop?: boolean;
  next?: string;
  noBlink?: boolean;
  tabletY?: number;
  linear?: string[];
  front?: string[];
  underTablet?: string[];
  bones: Record<string, ClipKey[]>;
  set: [number, Partial<RigShow>][];
}

export interface EyeShapeInfo {
  white: boolean;
  irisScale: number;
}

export interface HandAnchor {
  ax: number;
  ay: number;
  rot: number;
  rotFlip: number;
}

export interface RigModel {
  version: number;
  rev: number;
  canvas: number;
  axisX: number;
  bones: RigBone[];
  layers: RigLayer[];
  armPoses: Record<string, [number, number]>;
  armFront: ArmFrontRule;
  show: RigShow;
  masks: Record<string, RigMask>;
  eyeShapes: Record<string, EyeShapeInfo>;
  irisVariants: string[];
  handAnchors: Record<string, HandAnchor>;
  mouths: string[];
  fx: string[];
  clips: Record<string, RigClip>;
  moods: Record<string, Partial<RigShow>>;
}

type RigFile = Omit<
  RigModel,
  'masks' | 'eyeShapes' | 'irisVariants' | 'handAnchors' | 'mouths' | 'fx' | 'clips' | 'moods'
>;

export interface ModelSources {
  rig: string;
  masks: string;
  eyes: string;
  hands: string;
  fx: string;
  clips: string;
}

export function emptyShow(): RigShow {
  return {
    eyes: 'open',
    eyeShape: 'orig',
    iris: 'orig',
    mouth: 'closed',
    brows: 'orig',
    hand_l: 'relaxed',
    hand_r: 'relaxed',
    fx: [],
    fxSet: 1,
    headphones: false,
    tablet: 'none',
    glow: true
  };
}

// Исходные файлы — это скрипты вида `window.ИМЯ = {...}`. Выполняем их в пустой
// области с поддельным window, чтобы достать данные без редактора и без DOM.
export function extractGlobals(source: string): Record<string, unknown> {
  const win: Record<string, unknown> = {};
  const run = new Function('window', source) as (w: Record<string, unknown>) => void;
  run(win);
  return win;
}

function pick<T>(win: Record<string, unknown>, name: string): T {
  const value = win[name];
  if (value === undefined) {
    throw new Error(`В исходнике нет window.${name}`);
  }
  return value as T;
}

export function buildModel(sources: ModelSources): RigModel {
  const rig = pick<RigFile>(extractGlobals(sources.rig), 'RIG_FILE');
  const eyesWin = extractGlobals(sources.eyes);
  const fxWin = extractGlobals(sources.fx);
  const clipsWin = extractGlobals(sources.clips);
  return {
    version: rig.version,
    rev: rig.rev,
    canvas: rig.canvas,
    axisX: rig.axisX,
    bones: rig.bones,
    layers: rig.layers,
    armPoses: rig.armPoses,
    armFront: rig.armFront,
    show: rig.show,
    masks: pick<Record<string, RigMask>>(extractGlobals(sources.masks), 'MASKS'),
    eyeShapes: pick<Record<string, EyeShapeInfo>>(eyesWin, 'EYE_SHAPES'),
    irisVariants: pick<string[]>(eyesWin, 'IRIS_VARIANTS'),
    handAnchors: pick<Record<string, HandAnchor>>(extractGlobals(sources.hands), 'HAND_ANCHORS'),
    mouths: pick<string[]>(fxWin, 'MOUTHS'),
    fx: pick<string[]>(fxWin, 'FX'),
    clips: pick<Record<string, RigClip>>(clipsWin, 'CLIPS'),
    moods: pick<Record<string, Partial<RigShow>>>(clipsWin, 'MOODS')
  };
}

export function parseModel(text: string): RigModel {
  return JSON.parse(text) as RigModel;
}

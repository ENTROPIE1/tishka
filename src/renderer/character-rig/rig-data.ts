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
  sx?: number;
  sy?: number;
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
  eyes: 'open' | 'half' | 'closed';
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

// Эмоция — статичный набор лица и добавки к костям: уши [левое, правое] в градусах,
// голова [наклон°, сдвиг вниз], browY — брови выше (минус) или ниже.
export interface RigEmotion extends Partial<RigShow> {
  ru: string;
  ears: [number, number];
  head: [number, number];
  browY?: number;
}

// Анимированная эмоция — короткая сценка поверх любого клипа: добавки к костям
// ([время, поворот, сдвиг x, сдвиг y]), смена частей лица по времени и значки.
export interface RigEmote {
  ru: string;
  len: number;
  loop?: boolean;
  bones: Record<string, ClipKey[]>;
  face: [number, Partial<RigShow>][];
  fx: string[];
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
  // Из emotions.js; в модели без него полей нет.
  emotions?: Record<string, RigEmotion>;
  emotes?: Record<string, RigEmote>;
  emotionFx?: string[];
  moodEmotion?: Record<string, string>;
}

type RigFile = Omit<
  RigModel,
  'masks' | 'eyeShapes' | 'irisVariants' | 'handAnchors' | 'mouths' | 'fx' | 'clips' | 'moods' | 'emotions' | 'emotes' | 'emotionFx' | 'moodEmotion'
> & { emotions?: Record<string, Partial<RigEmotion>> };

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

// emotions — текст emotions.js; без него модель собирается без эмоций и сценок.
export function buildModel(sources: ModelSources, emotions?: string): RigModel {
  const rig = pick<RigFile>(extractGlobals(sources.rig), 'RIG_FILE');
  const eyesWin = extractGlobals(sources.eyes);
  const fxWin = extractGlobals(sources.fx);
  const clipsWin = extractGlobals(sources.clips);
  const emoWin = emotions !== undefined ? extractGlobals(emotions) : {};
  const eyeShapes = pick<Record<string, EyeShapeInfo>>(eyesWin, 'EYE_SHAPES');
  const irisVariants = pick<string[]>(eyesWin, 'IRIS_VARIANTS');
  return {
    version: rig.version,
    rev: rig.rev,
    canvas: rig.canvas,
    axisX: rig.axisX,
    bones: rig.bones,
    layers: completeLayers(rig.layers, eyeShapes, irisVariants),
    armPoses: rig.armPoses,
    armFront: rig.armFront,
    show: rig.show,
    masks: pick<Record<string, RigMask>>(extractGlobals(sources.masks), 'MASKS'),
    eyeShapes,
    irisVariants,
    handAnchors: pick<Record<string, HandAnchor>>(extractGlobals(sources.hands), 'HAND_ANCHORS'),
    mouths: pick<string[]>(fxWin, 'MOUTHS'),
    fx: pick<string[]>(fxWin, 'FX'),
    clips: pick<Record<string, RigClip>>(clipsWin, 'CLIPS'),
    moods: pick<Record<string, Partial<RigShow>>>(clipsWin, 'MOODS'),
    emotions: mergeEmotions((emoWin.EMOTIONS ?? {}) as Record<string, RigEmotion>, rig.emotions ?? {}),
    emotes: (emoWin.EMOTES ?? {}) as Record<string, RigEmote>,
    emotionFx: (emoWin.EMOTION_FX ?? []) as string[],
    moodEmotion: (emoWin.MOOD_EMOTION ?? {}) as Record<string, string>
  };
}

// Слой по умолчанию, как его заводит редактор модели (кости.html).
function editorLayer(id: string, bone: string, extra: Partial<RigLayer> = {}): RigLayer {
  return { id, src: `layers/${id}.png`, bone, dx: 0, dy: 0, ...extra };
}

// Глаз по схеме редактора: белки (исходный открытый и полуприкрытый, формы с белком),
// зрачок с бликом и варианты зрачка, контуры век и форм.
function editorEyeLayers(s: 'l' | 'r', eyeShapes: Record<string, EyeShapeInfo>, irisVariants: string[]): RigLayer[] {
  const eye = `eye_${s}`;
  const iris = `iris_${s}`;
  const shapes = Object.keys(eyeShapes);
  const out: RigLayer[] = [
    editorLayer(`eye_${s}_white`, eye, { group: `eyeWhite_${s}`, variant: 'orig', eyePart: 'white', side: s, shape: 'orig', lid: 'open' }),
    editorLayer(`eye_${s}_half_white`, eye, { group: `eyeWhite_${s}`, variant: 'orig_half', eyePart: 'white', side: s, shape: 'orig', lid: 'half' })
  ];
  for (const sh of shapes) {
    if (eyeShapes[sh]?.white === true) {
      out.push(editorLayer(`eye_${s}_${sh}_white`, eye, { group: `eyeWhite_${s}`, variant: sh, eyePart: 'white', side: s, shape: sh }));
    }
  }
  out.push(editorLayer(`eye_${s}_iris`, iris, { group: `eyeIris_${s}`, variant: 'orig', eyePart: 'iris', side: s, iris: 'orig' }));
  out.push(editorLayer(`eye_${s}_highlight`, iris, { group: `eyeIris_${s}`, variant: 'orig_hl', eyePart: 'hl', side: s, iris: 'orig' }));
  for (const iv of irisVariants.slice(1)) {
    out.push(editorLayer(`iris_${s}_${iv}`, iris, { group: `eyeIris_${s}`, variant: iv, eyePart: 'iris', side: s, iris: iv }));
  }
  for (const lid of ['open', 'half', 'closed']) {
    out.push(editorLayer(`eye_${s}_${lid}`, eye, { group: `eyeLine_${s}`, variant: lid, eyePart: 'line', side: s, shape: 'orig', lid }));
  }
  for (const sh of shapes) {
    out.push(editorLayer(`eye_${s}_${sh}_line`, eye, { group: `eyeLine_${s}`, variant: sh, eyePart: 'line', side: s, shape: sh, lid: 'open' }));
  }
  return out;
}

// Редактор при загрузке rig.json переописывает слои глаз (сдвиги сохраняет) и
// достраивает слои, которых в файле ещё нет: полуприкрытые белки, мяч, слёзы.
// Повторяем это здесь, чтобы приложение видело модель так же, как редактор.
export function completeLayers(layers: RigLayer[], eyeShapes: Record<string, EyeShapeInfo>, irisVariants: string[]): RigLayer[] {
  const eyes = [...editorEyeLayers('l', eyeShapes, irisVariants), ...editorEyeLayers('r', eyeShapes, irisVariants)];
  const byId = new Map(eyes.map((l) => [l.id, l]));
  const out = layers.map((l) => {
    const fresh = /^(eye|iris)_/.test(l.id) ? byId.get(l.id) : undefined;
    return fresh !== undefined ? { ...fresh, dx: l.dx ?? 0, dy: l.dy ?? 0 } : l;
  });
  eyes.forEach((layer, i) => {
    if (out.some((x) => x.id === layer.id)) {
      return;
    }
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) {
      at = out.findIndex((x) => x.id === eyes[j]?.id);
    }
    out.splice(at + 1, 0, layer);
  });
  const extras = [
    editorLayer('prop_ball', 'ball', { ball: true }),
    editorLayer('tear_l', 'tear_l', { fxName: 'tearrun', fxSet: 1 }),
    editorLayer('tear_r', 'tear_r', { fxName: 'tearrun', fxSet: 1 })
  ];
  for (const layer of extras) {
    if (!out.some((x) => x.id === layer.id)) {
      out.push(layer);
    }
  }
  return out;
}

// Правки эмоций, сохранённые редактором в rig.json (rig.emotions), главнее emotions.js.
export function mergeEmotions(
  base: Record<string, RigEmotion>,
  overrides: Record<string, Partial<RigEmotion>>
): Record<string, RigEmotion> {
  const out: Record<string, RigEmotion> = {};
  for (const [name, emotion] of Object.entries(base)) {
    out[name] = { ...emotion, ...(overrides[name] ?? {}) };
  }
  return out;
}

export function parseModel(text: string): RigModel {
  return JSON.parse(text) as RigModel;
}

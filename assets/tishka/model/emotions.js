// Эмоции Тишки — три независимых блока, которые складываются:
//   ДЕЙСТВИЕ (clips.js) — что делает телом;
//   ЭМОЦИЯ (EMOTIONS) — статичный набор лица: уши, веки, форма глаз, зрачок, брови, рот в покое, значки эмоции, наклон головы;
//   АНИМИРОВАННАЯ ЭМОЦИЯ (EMOTES) — короткая сценка лица и головы поверх любого действия.
// Уши: ears [левое, правое] в градусах. Минус у левого / плюс у правого — кончики наружу и вниз (поникли),
// наоборот — к центру и вверх (навострены). head: [наклон°, сдвиг вниз]. browY — брови выше (минус) или ниже.
// Владелица может переписать любую эмоцию в программе — правки хранятся в rig.json (rig.emotions) и главнее этих.

window.EMOTIONS = {
  calm:      { ru: 'спокойствие', eyes: 'open', eyeShape: 'orig',      iris: 'orig',  brows: 'orig',      mouth: 'closed',   ears: [0, 0],     head: [0, 0], fx: [] },
  joy:       { ru: 'радость',     eyes: 'open', eyeShape: 'smiling',   iris: 'orig',  brows: 'kind',      mouth: 'm_e',      ears: [6, -6],    head: [0, 0], fx: [] },
  delight:   { ru: 'восторг',     eyes: 'open', eyeShape: 'happy',     iris: 'orig',  brows: 'kind',      mouth: 'laugh',    ears: [8, -8],    head: [0, 0], fx: ['sparkles'] },
  laugh:     { ru: 'смех',        eyes: 'open', eyeShape: 'laugh',     iris: 'orig',  brows: 'kind',      mouth: 'laugh',    ears: [4, -4],    head: [0, 0], fx: [] },
  anger:     { ru: 'злость',      eyes: 'open', eyeShape: 'angry',     iris: 'orig',  brows: 'angry',     mouth: 'sad',      ears: [-18, 18],  head: [0, 2], fx: ['vein'] },
  sadness:   { ru: 'печаль',      eyes: 'open', eyeShape: 'sad',       iris: 'orig',  brows: 'sad',       mouth: 'sad',      ears: [-26, 26],  head: [0, 4], fx: [] },
  surprise:  { ru: 'удивление',   eyes: 'open', eyeShape: 'surprised', iris: 'orig',  brows: 'surprised', mouth: 'wow',      ears: [10, -10],  head: [0, -2], browY: -9, fx: [] },
  confused:  { ru: 'растерянность', eyes: 'open', eyeShape: 'sad',     iris: 'orig',  brows: 'worried',   mouth: 'grumpy',   ears: [-10, 10],  head: [5, 0], fx: ['sweat'] },
  skeptic:   { ru: 'скепсис',     eyes: 'half', eyeShape: 'orig',      iris: 'orig',  brows: 'skeptical', mouth: 'grumpy',   ears: [6, 6],     head: [-3, 0], fx: [] },
  shy:       { ru: 'смущение',    eyes: 'open', eyeShape: 'happy',     iris: 'orig',  brows: 'kind',      mouth: 'closed',   ears: [-8, 8],    head: [6, 2], fx: ['blush'] },
  love:      { ru: 'влюблён',     eyes: 'open', eyeShape: 'orig',      iris: 'heart', brows: 'kind',      mouth: 'closed',   ears: [6, -6],    head: [3, 0], browY: -6, fx: ['hearts'] },
  focus:     { ru: 'сосредоточен', eyes: 'open', eyeShape: 'orig',     iris: 'orig',  brows: 'focused',   mouth: 'm_closed', ears: [8, -8],    head: [0, 2], fx: [] },
  tired:     { ru: 'томность',    eyes: 'open', eyeShape: 'sleepy',    iris: 'orig',  brows: 'orig',      mouth: 'm_closed', ears: [-20, 20],  head: [0, 4], fx: [] },
};
// значки, которые относятся к эмоции (остальные — к действию: шестерёнка, лампочка, ноты…)
window.EMOTION_FX = ['blush', 'sweat', 'vein', 'steam', 'tear', 'tearrun', 'hearts', 'heart', 'sparkles', 'question', 'exclaim', 'dizzy'];

// Анимированные эмоции: bones — добавки к позе (голова, уши, брови; [время, поворот°, сдвиг x, сдвиг y]),
// face — смена частей лица по времени, fx — значки на время сценки, loop — повторять.
window.EMOTES = {
  giggle:  { ru: 'хохочет', len: 1.2, loop: true,
    bones: { head: [[0, 0, 0, 0], [0.15, -2, 0, 3], [0.3, 0, 0, 0], [0.45, 2, 0, 3], [0.6, 0, 0, 0], [0.75, -2, 0, 3], [0.9, 0, 0, 0], [1.05, 2, 0, 3], [1.2, 0, 0, 0]],
             ear_l: [[0, 0], [0.08, 12], [0.18, 0], [0.3, 0], [0.38, 12], [0.48, 0], [0.6, 0], [0.68, 12], [0.78, 0], [0.9, 0], [0.98, 12], [1.08, 0], [1.2, 0]],
             ear_r: [[0, 0], [0.08, -12], [0.18, 0], [0.3, 0], [0.38, -12], [0.48, 0], [0.6, 0], [0.68, -12], [0.78, 0], [0.9, 0], [0.98, -12], [1.08, 0], [1.2, 0]] },
    face: [[0, { eyeShape: 'laugh', brows: 'kind', mouth: 'laugh' }], [0.15, { mouth: 'm_a' }], [0.3, { mouth: 'laugh' }], [0.45, { mouth: 'm_a' }],
           [0.6, { mouth: 'laugh' }], [0.75, { mouth: 'm_a' }], [0.9, { mouth: 'laugh' }], [1.05, { mouth: 'm_a' }]], fx: [] },
  rage:    { ru: 'злится', len: 1.0, loop: true,
    bones: { head: [[0, 0], [0.06, 3], [0.12, -3], [0.18, 3], [0.24, -3], [0.3, 0], [1.0, 0]],
             ear_l: [[0, -20], [1.0, -20]], ear_r: [[0, 20], [1.0, 20]], brow_l: [[0, 0, 0, 2], [1, 0, 0, 2]], brow_r: [[0, 0, 0, 2], [1, 0, 0, 2]] },
    face: [[0, { eyeShape: 'angry', brows: 'angry', mouth: 'grin' }]], fx: ['steam', 'vein'] },
  cry:     { ru: 'плачет', len: 1.6, loop: true,
    bones: { head: [[0, 0, 0, 5], [0.2, 0, 0, 8], [0.4, 0, 0, 5], [0.6, 0, 0, 8], [0.8, 0, 0, 5], [1.6, 0, 0, 5]],
             ear_l: [[0, -28], [1.6, -28]], ear_r: [[0, 28], [1.6, 28]],
             tear_l: [[0, 0, 0, 0], [1.2, 0, -4, 34], [1.21, 0, 0, 0], [1.6, 0, 0, 0]],
             tear_r: [[0, 0, 0, 0], [0.4, 0, 0, 0], [1.6, 0, 4, 34]] },
    face: [[0, { eyeShape: 'laugh', brows: 'sad', mouth: 'sad' }]], fx: ['tearrun'] },
  startle: { ru: 'вздрогнул', len: 0.9,
    bones: { head: [[0, 0, 0, 0], [0.08, 0, 0, -8], [0.25, 0, 0, -4], [0.9, 0, 0, 0]],
             ear_l: [[0, 0], [0.08, 14], [0.4, 10], [0.9, 0]], ear_r: [[0, 0], [0.08, -14], [0.4, -10], [0.9, 0]],
             brow_l: [[0, 0, 0, 0], [0.08, 0, 0, -11], [0.6, 0, 0, -9], [0.9, 0, 0, 0]], brow_r: [[0, 0, 0, 0], [0.08, 0, 0, -11], [0.6, 0, 0, -9], [0.9, 0, 0, 0]] },
    face: [[0, { eyeShape: 'surprised', iris: 'shock', brows: 'surprised', mouth: 'wow' }]], fx: ['exclaim'] },
  nod:     { ru: 'кивает', len: 1.0,
    bones: { head: [[0, 0, 0, 0], [0.2, 0, 0, 6], [0.4, 0, 0, 0], [0.6, 0, 0, 6], [0.8, 0, 0, 0], [1.0, 0, 0, 0]] },
    face: [[0, { eyeShape: 'smiling', brows: 'kind', mouth: 'm_e' }]], fx: [] },
  shake:   { ru: 'мотает «нет»', len: 1.0,
    bones: { head: [[0, 0], [0.15, -5], [0.35, 5], [0.55, -5], [0.75, 5], [1.0, 0]] },
    face: [[0, { brows: 'worried', mouth: 'grumpy' }]], fx: [] },
  puzzle:  { ru: 'озадачен', len: 1.6, loop: true,
    bones: { head: [[0, 0], [0.4, 8], [1.2, 8], [1.6, 0]], ear_l: [[0, 0], [0.5, 0], [0.56, 10], [0.64, 0], [1.6, 0]] },
    face: [[0, { brows: 'skeptical', mouth: 'grumpy' }]], fx: ['question'] },
  wink:    { ru: 'подмигивает', len: 0.9,
    bones: { head: [[0, 0], [0.2, 4], [0.7, 4], [0.9, 0]] },
    face: [[0, { brows: 'kind', mouth: 'm_e' }], [0.15, { wink: 'r' }], [0.6, { wink: '' }]], fx: [] },
  huff:    { ru: 'фыркает', len: 0.9,
    bones: { head: [[0, 0, 0, 0], [0.12, -4, 0, -4], [0.5, -4, 0, -4], [0.9, 0, 0, 0]], ear_l: [[0, 0], [0.12, -12], [0.9, 0]], ear_r: [[0, 0], [0.12, 12], [0.9, 0]] },
    face: [[0, { eyeShape: 'angry', brows: 'angry', mouth: 'grumpy' }]], fx: ['steam'] },
  blush:   { ru: 'смущается', len: 1.6, loop: true,
    bones: { head: [[0, 6, 0, 2], [0.8, 8, 0, 3], [1.6, 6, 0, 2]], iris_l: [[0, 0, -3, 3], [1.6, 0, -3, 3]], iris_r: [[0, 0, -3, 3], [1.6, 0, -3, 3]] },
    face: [[0, { eyeShape: 'orig', brows: 'kind', mouth: 'closed' }]], fx: ['blush'] },
};

// настроение ответа модели (mood) → эмоция
window.MOOD_EMOTION = { neutral: 'calm', happy: 'joy', confused: 'confused' };

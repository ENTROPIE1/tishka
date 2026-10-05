"""Дорожка рта для фраз: громкость из WAV + формы рта по буквам текста. python tools/lipsync.py"""
import wave, json, numpy as np, re
PHRASES = ['Привет! Я Тишка, чем могу помочь?', 'Сейчас посмотрю.', 'Готово, открыл.', 'Вот что нашёл.',
           'Не вышло, письмо не сохранилось.', 'Ой, я не понял. Повтори, пожалуйста.', 'Ура! Навык сохранён.',
           'Хм, дай подумать.', 'Напоминаю: через десять минут планёрка.']
FPS = 60
VIS = {}
for ch in 'аяАЯ': VIS[ch] = 'm_a'
for ch in 'оёОЁ': VIS[ch] = 'm_o'
for ch in 'уюУЮ': VIS[ch] = 'm_u'
for ch in 'эеиыЭЕИЫ': VIS[ch] = 'm_e'
for ch in 'мбпМБП': VIS[ch] = 'm_closed'
for ch in 'фвФВ': VIS[ch] = 'm_f'
for ch in 'лЛ': VIS[ch] = 'm_l'
VOWELS = set('аяоёуюэеиыАЯОЁУЮЭЕИЫ')

def envelope(path):
    w = wave.open(path); n = w.getnframes(); sr = w.getframerate(); ch = w.getnchannels(); sw = w.getsampwidth()
    a = np.frombuffer(w.readframes(n), dtype={1: np.int8, 2: np.int16, 4: np.int32}[sw]).astype(float)
    if ch > 1: a = a.reshape(-1, ch).mean(1)
    hop = sr // FPS; frames = len(a) // hop
    env = np.array([np.sqrt(np.mean(a[i * hop:(i + 1) * hop] ** 2)) for i in range(frames)])
    env = np.convolve(env, np.ones(3) / 3, mode='same')     # сгладить
    return env / (env.max() or 1), sr, len(a) / sr

out = []
for i, text in enumerate(PHRASES, 1):
    env, sr, dur = envelope(f'speech/phrase_{i}.wav')
    active = env > 0.08                                      # кадры, где звучит голос
    letters = [c for c in text if re.match(r'[а-яёА-ЯЁ]', c)]
    weights = np.array([1.0 if c in VOWELS else 0.6 for c in letters])
    act_idx = np.nonzero(active)[0]
    track = ['rest'] * len(env)
    if len(act_idx):
        cum = np.concatenate([[0], np.cumsum(weights)]) / weights.sum() * len(act_idx)
        for k, c in enumerate(letters):
            a0, a1 = int(round(cum[k])), max(int(round(cum[k + 1])), int(round(cum[k])) + 1)
            for j in act_idx[a0:a1]:
                v = VIS.get(c, 'm_teeth')
                if c in VOWELS and env[j] < 0.3: v = 'm_teeth' if v in ('m_a', 'm_e') else v   # тихий гласный — рот почти закрыт
                track[j] = v
    # без мелькания: форма держится не меньше 3 кадров (50 мс)
    events = []
    for t, v in enumerate(track):
        if not events or events[-1][1] != v:
            if events and t - events[-1][0] < 3 and len(events) > 1: events[-1][1] = v; continue
            events.append([t, v])
    out.append({'text': text, 'wav': f'speech/phrase_{i}.wav', 'fps': FPS, 'frames': len(env),
                'mouth': events, 'env': [round(float(x), 3) for x in env]})
    print(f'{i}: {dur:.2f} с, {len(events)} смен формы рта')
open('speech/phrases.js', 'w', encoding='utf-8').write('// тестовые фразы голосом Тишки: громкость по кадрам (60 в секунду) и смены формы рта\nwindow.PHRASES=' + json.dumps(out, ensure_ascii=False) + ';\n')

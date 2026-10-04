# 54. Поиск ошибок — окна (src/renderer/pet, src/renderer/shared, src/renderer/chat, src/main)

Ничего не исправлялось. Подозрения проверялись чтением кода и временными тестами (vitest, jsdom); тесты из репозитория удалены, их текст приведён в отчёте.

---

## 1. Очередь речи зависает навсегда, если воспроизведение остановлено до его начала или окно перезагружено во время речи

**Файл:** `src/renderer/pet/speaker.ts:55-67` (finish/stop), `speaker.ts:83-85` (потерянное завершение при устаревшем поколении); усиливается `src/main/pet-window.ts:199-203` (reload).

**Шаги у пользователя:**
1. TTS включён. Тишка отвечает, звук уходит в окно-питомец: главный процесс запомнил функцию завершения и ждёт только сообщения `speak-done` (`src/main/index.ts:156-169`).
2. Рендерер получил wav, но ещё декодирует его (первые десятки мс после `speak.start`).
3. Человек перебивает: жмёт микрофон/горячую клавишу или зовёт по имени → `listen.start` → `halt()` → `abort` → `pet.stopSpeaking()` → в рендерере `speaker.stop()`.
4. `stop()` вызывает `finish()`, но тот выходит, потому что `active` ещё `false` (декодирование не закончилось); когда декодирование завершается, проверка `current !== generation` молча выходит — `onDone` не вызывается ни одним путём.
5. `speak-done` не уходит в главный процесс, обещание `play` в очереди речи не разрешается никогда: `speech-queue.run()` навсегда остаётся в `running`, все последующие `enqueue` игнорируются.

Второй путь того же дефекта: `memory-watch` перезагружает окна по лимиту памяти (`speak.start` не входит в признак занятости в `src/main/index.ts:275-281`, а `processing` уже сброшен событием `idle`) — `pet-window.ts:reload()` уничтожает проигрывание, `speak-done` тоже теряется.

**Что видит пользователь:** Тишка замолкает и больше не озвучивает ни один ответ до перезапуска приложения (в чате и на экране всё остальное работает, объяснений нет).

**Подтверждение:** тест (падает: `onDone` не вызван).

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createSpeaker } from '../src/renderer/pet/speaker';

it('speaker: stop до окончания декодирования не доходит до onDone — очередь речи зависает', async () => {
  let resolveDecode: (buffer: unknown) => void = () => undefined;
  const decodePromise = new Promise((resolve) => { resolveDecode = resolve; });
  class FakeSource {
    onended: (() => void) | null = null;
    connect(): FakeSource { return this; }
    start(): void {}
    stop(): void {}
  }
  class FakeGain { gain = { value: 0 }; connect(): void {} }
  class FakeContext {
    destination = {};
    currentTime = 0;
    resume(): Promise<void> { return Promise.resolve(); }
    decodeAudioData(): Promise<unknown> { return decodePromise; }
    createBufferSource(): FakeSource { return new FakeSource(); }
    createGain(): FakeGain { return new FakeGain(); }
  }
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeContext;

  const onDone = vi.fn();
  const speaker = createSpeaker({ setMouth: () => undefined, onDone });

  speaker.play({ wav: new Uint8Array([1, 2, 3, 4]), volume: 1 }); // декодирование ещё идёт
  speaker.stop();                                                  // перебивание в этот момент
  resolveDecode({ getChannelData: () => new Float32Array(0), sampleRate: 16000 });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

  expect(onDone).toHaveBeenCalledOnce(); // фактический вызов: 0 раз
});
```

**Как исправить:** в `speaker.stop()` завершать и «ещё не начавшееся» воспроизведение — например, помнить обещание текущего `play` и вызывать `onDone` при остановке до `active`, либо в `main/index.ts` разрешать обещание `play` и по `abort`. Дополнительно перечитывать очередь при `reload()` окна-питомца.

---

## 2. Кнопки микрофона не оживают после настройки распознавания: опрос готовности заканчивается через 60 секунд навсегда

**Файлы:** `src/renderer/shared/mic-button.ts:81-96` (лимит в строках 88-91), `src/renderer/chat/talk-mode.ts:77-92` (тот же код в строках 84-87).

**Шаги у пользователя:**
1. Запуск без настроенной службы распознавания (или служба поднимается дольше минуты — первый запуск, медленный диск, загрузка модели).
2. `refresh()` опрашивает `voice.status()` каждые 1,5 с, после 40 неудач больше не вызывает себя ни при каких событиях (нет подписки на смену настроек, нет опроса по фокусу).
3. Человек настраивает распознавание в настройках; `petWake.broadcast()`/`chatTalk.broadcast()` обновляют состояние, но не флаг `disabled`.
4. Пользователь возвращается в чат и жмёт значок микрофона (или открывает давнюю карточку ввода).

**Что видит пользователь:** значок заблокирован с подсказкой «Распознавание речи не настроено», хотя служба уже готова; говорить голосом нельзя до перезагрузки окна. Отдельно: единственный сбой `voice.status()` в `.catch` тоже глушит опрос до пересоздания кнопки.

**Подтверждение:** тест (падает: кнопка остаётся заблокированной, хотя статус давно `ready`).

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMicButton } from '../src/renderer/shared/mic-button';

it('mic-button: после настройки распознавания кнопка не оживает, если опрос исчерпан', async () => {
  vi.useFakeTimers();
  let calls = 0;
  (window as unknown as { tishka: unknown }).tishka = {
    voice: {
      status: async () => {
        calls += 1;
        return { state: calls <= 41 ? 'starting' : 'ready' }; // готова на 42-й секунде опроса
      }
    }
  };
  const mic = createMicButton({ onText: () => undefined, onLevel: () => undefined, onListeningChange: () => undefined });
  document.body.append(mic.element);

  await vi.advanceTimersByTimeAsync(180_000);

  expect(mic.element.disabled).toBe(false); // фактический результат: true
});
```

**Как исправить:** после исчерпания лимита перепроверять готовность по событию (например, `config.onChanged` или по фокусу окна) либо продолжать редкий опрос; в `.catch` тоже планировать повторную попытку.

---

## 3. Перезагрузка ленты стирает карточки ввода вместе с набранным, но не отправленным текстом

**Файл:** `src/renderer/chat/feed.ts:190-204` (`clear`/`refill` удаляют всё, включая неисторические ряды); сценарий запускается из `src/renderer/chat/chat.ts:53-57` — `refill` на каждое событие `listen.end`.

**Шаги у пользователя:**
1. Тишка отвечает с `ask` — в чате появляется карточка ввода; человек начинает печатать ответ.
2. Не отправляя черновик, человек подаёт любую голосовую или текстовую реплику (в режиме разговора, из строки компоновщика, из другой карточки).
3. Ядро издаёт `listen.end`, чат перечитывает историю через `refill`.

**Что видит пользователь:** карточка ввода и черновик исчезают; карточки «Навык сохранён» тоже удаляются. По замыслу (`feed.ts:141`, `ask-card.ts`) карточка живёт до отмены — потеря текста выглядит как пропажа.

**Подтверждение:** тест (падает: поля ввода больше нет).

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createChatFeed } from '../src/renderer/chat/feed';

it('feed: refill стирает карточку ввода вместе с набранным черновиком', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const feed = createChatFeed(container);
  feed.appendAskCard({ title: 'Текст для итога' });
  const field = container.querySelector('.ask-input') as HTMLTextAreaElement;
  field.value = 'черновик ответа';

  feed.refill([{ kind: 'message', id: 'a', at: '2026-10-02T10:00:00.000Z', from: 'user', text: 'привет' }]);

  expect(container.querySelector('.ask-input')?.value).toBe('черновик ответа'); // фактически: undefined
});
```

**Как исправить:** при `refill` сохранять и возвращать на место открытые карточки ввода (и карточки навыков), либо перерисовывать ленту добавлением, не трогая «живые» ряды.

---

## 4. Новый ответ с точно такой же карточкой не показывается, если прежнюю закрыли

**Файл:** `src/renderer/pet/pet-card.ts:25-59` (сравнение ключа в строке 28, `closed` не сбрасывается для совпадающего ответа).

**Шаги у пользователя:**
1. Тишка показывает карточку (например, список «что я умею»); человек закрывает её крестом.
2. Человек снова просит то же самое; модель возвращает тот же `show` (та же панель по содержимому).
3. `pet/state.ts` на `reply` строит новую модель с этой карточкой, рендерер получает её повторно.

**Что видит пользователь:** новой карточки нет — `render` видит совпадение ключа, пропускает пересборку, и `closed` продолжает прятать окно; в облаке текст есть, а карточки нет.

**Подтверждение:** тест (падает: `host.hidden` остаётся `true`).

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { PetModel } from '../src/pet/state';
import type { Panel } from '../src/core/types';
import { createPetCard } from '../src/renderer/pet/pet-card';

it('pet-card: новый ответ с той же карточкой не показывается после закрытия прежней', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const card = createPetCard({ element: host, refreshBusy: vi.fn() });
  const panel: Panel = { kind: 'text', title: 'Итог', markdown: 'готово' };
  const model = (): PetModel => ({ state: 'talking', since: 0, queue: [], panel });

  card.render(model());
  (host.querySelector('.card-close') as HTMLButtonElement).click();
  expect(host.hidden).toBe(true);

  card.render(model());

  expect(host.hidden).toBe(false); // фактически: true
});
```

**Как исправить:** при появлении нового события `reply` сбрасывать `closed` всегда (например, передавать в `render` признак новой реплики), а не только при изменении содержимого.

---

## 5. В режиме разговора чата ошибка микрофона не повторяется: разговор числится включённым, но микрофон не слушается до ручного выключения

**Файл:** `src/renderer/chat/talk-mode.ts:40-61` — при неудаче `listener.start()` объект остаётся в `listener`, и все следующие состояния с `conversation: true` (в том числе после того, как доступ к микрофону появился) считаются «уже слушаем».

Для сравнения, у питомца та же ситуация разбирается в `src/renderer/pet/wake-listener.ts:51-56, 38-49` повторной попыткой раз в 30 секунд.

**Шаги у пользователя:**
1. В окне чата человек включает разговор, но микрофон занят другой программой или устройство исчезло — `capture.start` возвращает неудачу, в статусе мелькает «Не слышу микрофон».
2. Человек освобождает микрофон и продолжает говорить.

**Что видит пользователь:** индикатор «Слушаю…» горит, уровень тишины, Тишка не реагирует на голос; помогает только выключить и заново включить значок.

**Подтверждение:** чтением кода (после неудачи `listener !== undefined`, ветка пересоздания в `apply` недостижима).

**Как исправить:** при `onError` обнулять `listener` и назначать повторную попытку (как `scheduleRetry` в wake-listener), пока разговор включён.

---

## 6. Каждая карточка ввода навсегда вешает слушатель Escape на документ

**Файл:** `src/renderer/shared/mic-button.ts:114-118`.

**Шаги у пользователя:** в длинном разговоре Тишка несколько раз просит ввести текст; каждая карточка создаёт свой `createMicButton`, а тот добавляет `document.addEventListener('keydown', …)` без снятия. Карточки отменой удаляются из DOM, слушатели остаются навсегда вместе с замыканиями на рекордер и элементы.

**Что видит пользователь:** напрямую ничего; в долгих сессиях растёт память и число обработчиков на каждое нажатие клавиши.

**Подтверждение:** чтением кода (`dispose`/отписки у mic-button нет; в отличие от talk-mode, у которого есть `dispose`, но его Escape-слушатель тоже не снимается — `talk-mode.ts:69-73`).

**Как исправить:** сохранить ссылку на обработчик и снимать его, когда кнопка убирается из документа (например, `AbortSignal` у `addEventListener` и `abort` при удалении карточки).

---

## 7. Поиск по истории молча выдаёт «пусто» при ошибке

**Файл:** `src/renderer/chat/search.ts:111-132` (`catch` в строках 125-130).

**Шаги у пользователя:** человек открывает поиск (Ctrl+F) и вводит запрос; вызов `historySearch` не удался (сбой IPC, перезагрузка окна в этот момент).

**Что видит пользователь:** панель результатов просто пустая — то же, что при «ничего не найдено»; объяснения нет, хотя ответа человек ждёт.

**Подтверждение:** чтением кода.

**Как исправить:** в `catch` показывать сообщение (например, «Поиск не удался») вместо беззвучной очистки результатов.

---

## 8. Щелчок «Новый разговор» при сбое IPC остаётся без всякой реакции

**Файл:** `src/renderer/chat/toolbar.ts:29-31` — `void window.tishka.newConversation().then(deps.reload)` без `catch`.

**Шаги у пользователя:** человек нажимает «Новый разговор»; invoke отклоняется (например, окно перезагружается в момент запроса).

**Что видит пользователь:** ничего — ни разделителя, ни сообщения; в консоли лишь необработанное отклонение.

**Подтверждение:** чтением кода.

**Как исправить:** добавить `catch` с сообщением пользователю (строкой статуса чата), как это сделано для других invoked-вызовов.

---

## 9. Превью картинки ломается, если в имени файла есть «#» или «%»

**Файл:** `src/renderer/shared/panels.ts:16-19` (`encodeURI` не кодирует `#`, `?`, `%`).

**Шаги у пользователя:** Тишка показывает карточку-картинку с путём вроде `C:\shots\итог #1.png` (скриншоты с решёткой в имени не редкость).

**Что видит пользователь:** вместо картинки — пустое место: всё после «#» стало фрагментом URL, `file:///C:/shots/итог%20` не существует. Сама копирование/открытие работают — ломается только предпросмотр.

**Подтверждение:** тест (падает: в `src` остаётся «#»).

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Panel } from '../src/core/types';
import { panelElement } from '../src/renderer/shared/panels';

it('panels: адрес картинки с решёткой в имени не кодируется — файл не находится', () => {
  const panel: Panel = { kind: 'image', title: 'Снимок', path: 'C:/shots/итог #1.png' };
  const card = panelElement(panel, {});
  const img = card.querySelector('img') as HTMLImageElement;

  expect(img.src).not.toContain('#'); // фактически: "file:///C:/shots/итог%20#1.png"
});
```

**Как исправить:** собирать `file://`-адрес из посегментно закодированных частей пути (`encodeURIComponent` для каждого сегмента), а не одним `encodeURI`.

---

## Просмотрено, ошибок не найдено

- `src/renderer/pet/composer.ts` — очередь отправки при «думает»/«работает» корректно сбрасывается при выходе из занятого состояния; повторные вызовы `setBusy(false)` безопасны, порядок сообщений сохраняется; Esc с текстом и пустым полем ведёт себя по тестам. Сброс очереди безопасен: ядро сериализует `handleUserText` (`src/core/app.ts:210-217`).
- `src/renderer/pet/wake-listener.ts` — гонки при смене `active`/`sensitivity`/`threshold` во время незавершённого `start()` гасятся счётчиком `runId` в mic-capture; таймер повтора очищается на остановке; повтор `wakeError` удержан кулдауном 30 с в wake-flow.
- `src/renderer/shared/recorder.ts` — отмена во время `getUserMedia` не оставляет поток; `teardown` снимает обработчик, закрывает контекст и треки; «занят»-флаги (`starting`/`active`) снимаются во всех ветках.
- `src/renderer/shared/phrase-listener.ts` и `mic-capture.ts` — повторные start/stop, остановка до ответа `getUserMedia`, предролл 500 мс и порог минимальной фразы сверены; утечек микрофона нет.
- `src/renderer/shared/ask-card.ts` — пустой/переполненный текст, Esc, фокус после вставки — соответствуют тестам; `insertAtCursor` корректен на границах поля.
- `src/renderer/shared/links.ts` — не-http схемы не перехватываются, `dataset.url` не перекодируется.
- `src/renderer/chat/navigation.ts`, `src/main/navigation-guard.ts`, `src/main/chat-window.ts` — внешние переходы отменяются, собственная страница разрешается, экран отправляется после загрузки; повторный navigate при загрузке не теряется.
- `src/main/pet-window.ts` — сама анимация появления/ухода, перетаскивание и `dispose` (таймер, подписка, mover) в порядке; фокус по hotkey/click доходит, т.к. `bus.emit` синхронный.
- `src/main/preload.ts` — расхождений с `docs/contracts.md` не найдено: `secrets.get` наружу не отдаётся, ключи шлюза в окна не проходят, типы событий/Reply совпадают.

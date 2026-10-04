import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAKE_PROMPT, isDismiss, matchWake, wakePrompt } from '../src/voice/wake';
import { flush, makeHarness, voice, wav } from './wake-test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('matchWake', () => {
  it('находит имя и оставляет просьбу', () => {
    expect(matchWake('Тишка, какие у меня встречи?', ['тишка'])).toEqual({
      matched: true,
      rest: 'какие у меня встречи?'
    });
  });

  it('«Эй, Тишка!» — только обращение', () => {
    expect(matchWake('Эй, Тишка!', ['тишка'])).toEqual({ matched: true, rest: '' });
  });

  it('учитывает искажение «тишко»', () => {
    expect(matchWake('тишко напомни про отчёт', ['тишка'])).toEqual({ matched: true, rest: 'напомни про отчёт' });
  });

  it('снимает приветствие и искажение имени', () => {
    expect(matchWake('слушай тишку открой доску', ['тишка'])).toEqual({ matched: true, rest: 'открой доску' });
  });

  it('не срабатывает на похожие слова', () => {
    for (const text of ['В комнате тишина', 'Говори тише', 'Плюшевый мишка упал', 'Мне нужна книжка']) {
      expect(matchWake(text, ['тишка']).matched).toBe(false);
    }
  });

  it('имя на пятом слове не считается', () => {
    expect(matchWake('я вчера видел там тишка', ['тишка']).matched).toBe(false);
  });

  it('своё имя из wakeWords работает так же', () => {
    expect(matchWake('ёжик открой доску', ['ёжик'])).toEqual({ matched: true, rest: 'открой доску' });
    expect(matchWake('ежик, сколько времени', ['ёжик'])).toEqual({ matched: true, rest: 'сколько времени' });
  });
});

describe('wakePrompt', () => {
  it('подсказка называет помощника по первому имени', () => {
    expect(WAKE_PROMPT).toBe('Разговор с помощником по имени Тишка.');
    expect(wakePrompt(['Тишка'])).toBe('Разговор с помощником по имени Тишка.');
    expect(wakePrompt(['ёжик'])).toBe('Разговор с помощником по имени ёжик.');
    expect(wakePrompt(['', 'ёжик'])).toBe('Разговор с помощником по имени ёжик.');
    expect(wakePrompt([])).toBe('Разговор с помощником по имени Тишка.');
  });

  it('фраза распознаётся с подсказкой по имени из настроек', async () => {
    const h = makeHarness(['ёжик открой доску'], voice({ wakeWords: ['ёжик'] }));
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.prompts).toEqual(['Разговор с помощником по имени ёжик.']);
    expect(h.calls).toEqual(['открой доску']);
  });

  it('имя человека из памяти добавляется после основной фразы', () => {
    const base = wakePrompt(['тишка']);
    const withName = wakePrompt(['тишка'], 'Эвелина');
    expect(withName.startsWith(base)).toBe(true);
    expect(withName).toContain('Эвелина');
    expect(withName.length - base.length).toBeLessThanOrEqual(101);
  });

  it('имя из памяти длиннее предела обрезается до 100 символов', () => {
    const base = wakePrompt(['тишка']);
    const prompt = wakePrompt(['тишка'], 'я'.repeat(300));
    expect(prompt.endsWith('я'.repeat(100))).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(base.length + 1 + 100);
  });
});

describe('isDismiss', () => {
  it('распознаёт просьбы уйти', () => {
    const phrases = ['уходи', 'уйди', 'пока', 'всё, спасибо', 'спасибо, всё', 'отбой', 'хватит', 'можешь идти', 'свободен'];
    for (const text of phrases) {
      expect(isDismiss(text)).toBe(true);
    }
  });

  it('допускает имя в начале', () => {
    expect(isDismiss('Тишка, уходи')).toBe(true);
    expect(isDismiss('ёжик, пока', ['ёжик'])).toBe(true);
  });

  it('фраза с продолжением просьбой уйти не считается', () => {
    expect(isDismiss('уходи из этой задачи и открой другую')).toBe(false);
    expect(isDismiss('не уходи')).toBe(false);
  });
});

describe('wake-flow: связка', () => {
  it('фраза с именем и просьбой уходит в handleUserText', async () => {
    const h = makeHarness(['Тишка, какие у меня встречи?']);
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.calls).toEqual(['какие у меня встречи?']);
    expect(h.commands).toContain('conversation-on');
  });

  it('фраза без имени отбрасывается', async () => {
    const h = makeHarness(['просто болтовня']);
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual([]);
    expect(h.history).toEqual([]);
  });

  it('только имя начинает обычную запись', async () => {
    const h = makeHarness(['Тишка']);
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.calls).toEqual([]);
    expect(h.commands).toContain('listen');
    expect(h.flow.isConversation()).toBe(false);
  });

  it('во время ответа фразы не распознаются', async () => {
    const h = makeHarness(['раз', 'два']);
    h.flow.enableConversation();
    const gate = h.deferHandle();
    h.flow.handlePhrase(wav);
    await flush();
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    gate.resolve();
    await flush();
    expect(h.calls).toEqual(['раз']);
  });

  it('при выключенном прослушивании фраза не распознаётся', async () => {
    const h = makeHarness(['Тишка, привет'], voice({ wakeEnabled: false }));
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.transcribe).not.toHaveBeenCalled();
  });
});

describe('wake-flow: режим разговора', () => {
  it('две фразы подряд без имени уходят в handleUserText', async () => {
    const h = makeHarness(['раз', 'два']);
    h.flow.enableConversation();
    h.flow.handlePhrase(wav);
    await flush();
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.calls).toEqual(['раз', 'два']);
  });

  it('30 секунд тишины после ответа выключают режим и прячут окно', async () => {
    const h = makeHarness(['раз']);
    h.flow.enableConversation();
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(29999);
    expect(h.flow.isConversation()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.flow.isConversation()).toBe(false);
    expect(h.hidden()).toBe(1);
  });

  it('время раздумий в отсчёт не входит', async () => {
    const h = makeHarness(['раз']);
    h.flow.enableConversation();
    const gate = h.deferHandle();
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.flow.isConversation()).toBe(true);
    gate.resolve();
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.flow.isConversation()).toBe(false);
  });

  it('просьба уйти не уходит в модель', async () => {
    for (const text of ['Тишка, уходи', 'всё, спасибо']) {
      const h = makeHarness([text]);
      h.flow.enableConversation();
      h.flow.handlePhrase(wav);
      await flush();
      expect(h.calls).toEqual([]);
      expect(h.flow.isConversation()).toBe(false);
      expect(h.hidden()).toBe(1);
    }
  });

  it('фраза «уходи из этой задачи…» просьбой уйти не считается', async () => {
    const h = makeHarness(['уходи из этой задачи и открой другую']);
    h.flow.enableConversation();
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.calls).toEqual(['уходи из этой задачи и открой другую']);
    expect(h.flow.isConversation()).toBe(true);
  });

  it('ввод с клавиатуры продлевает разговор', async () => {
    const h = makeHarness([], voice());
    h.flow.enableConversation();
    await vi.advanceTimersByTimeAsync(20000);
    h.flow.onKeyboardInput();
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.flow.isConversation()).toBe(true);
    await vi.advanceTimersByTimeAsync(10001);
    expect(h.flow.isConversation()).toBe(false);
  });

  it('выключенный значок — фразы не распознаются', async () => {
    const h = makeHarness(['привет'], voice({ wakeEnabled: false }));
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it('горячая клавиша включает и повторно выключает режим разговора', async () => {
    const h = makeHarness([], voice());
    expect(h.flow.isConversation()).toBe(false);
    h.flow.toggleConversation();
    expect(h.flow.isConversation()).toBe(true);
    expect(h.commands).toContain('conversation-on');
    h.flow.toggleConversation();
    expect(h.flow.isConversation()).toBe(false);
    expect(h.commands).toContain('conversation-off');
    expect(h.hidden()).toBe(0);
  });

  it('за 5 секунд до ухода по тишине сообщает «скоро уйду»', async () => {
    const h = makeHarness([]);
    h.flow.enableConversation();
    await vi.advanceTimersByTimeAsync(24999);
    expect(h.flow.isLeavingSoon()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.flow.isLeavingSoon()).toBe(true);
    expect(h.soonChanges).toContain(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.flow.isConversation()).toBe(false);
    expect(h.flow.isLeavingSoon()).toBe(false);
    expect(h.hidden()).toBe(1);
  });

  it('фраза сбрасывает предупреждение о скором уходе', async () => {
    const h = makeHarness(['раз']);
    h.flow.enableConversation();
    await vi.advanceTimersByTimeAsync(25000);
    expect(h.flow.isLeavingSoon()).toBe(true);
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.flow.isLeavingSoon()).toBe(false);
  });
});

describe('wake-flow: окно чата', () => {
  it('две фразы подряд в чате уходят без нажатий', async () => {
    const h = makeHarness(['раз', 'два']);
    h.flow.enableConversation('chat');
    expect(h.flow.conversationOwner()).toBe('chat');
    h.flow.handlePhrase(wav);
    await flush();
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.calls).toEqual(['раз', 'два']);
  });

  it('тишина дольше срока выключает режим чата', async () => {
    const h = makeHarness(['раз']);
    h.flow.enableConversation('chat');
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.flow.isConversation()).toBe(false);
    expect(h.flow.conversationOwner()).toBeNull();
  });

  it('«уходи» выключает чат и не уходит в модель', async () => {
    const h = makeHarness(['уходи']);
    h.flow.enableConversation('chat');
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.calls).toEqual([]);
    expect(h.flow.isConversation()).toBe(false);
  });

  it('включение в чате выключает режим в окне-питомце', () => {
    const h = makeHarness([]);
    h.flow.enableConversation('pet');
    expect(h.flow.conversationOwner()).toBe('pet');
    h.flow.toggleConversation('chat');
    expect(h.flow.conversationOwner()).toBe('chat');
    expect(h.flow.isConversation()).toBe(true);
  });

  it('повторное нажатие в чате выключает разговор', () => {
    const h = makeHarness([]);
    h.flow.toggleConversation('chat');
    expect(h.flow.isConversation()).toBe(true);
    h.flow.toggleConversation('chat');
    expect(h.flow.isConversation()).toBe(false);
  });
});

describe('wake-flow: ошибки', () => {
  it('ошибка службы показывается один раз и повторяется через 30 секунд', async () => {
    const h = makeHarness([{ error: 'Не удалось обратиться к службе распознавания' }]);
    h.flow.enableConversation();
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.errors).toEqual(['Не удалось обратиться к службе распознавания']);

    h.flow.reportError('Не удалось обратиться к службе распознавания');
    await flush();
    expect(h.errors).toEqual(['Не удалось обратиться к службе распознавания']);

    await vi.advanceTimersByTimeAsync(30000);
    h.flow.reportError('Не удалось обратиться к службе распознавания');
    await flush();
    expect(h.errors).toEqual([
      'Не удалось обратиться к службе распознавания',
      'Не удалось обратиться к службе распознавания'
    ]);
  });

  it('«Не расслышал» не ошибка, а ошибка микрофона сообщается один раз', async () => {
    const h = makeHarness([{ error: 'Не расслышал' }]);
    h.flow.enableConversation();
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.errors).toEqual([]);

    h.flow.reportError('Не слышу микрофон');
    await flush();
    expect(h.errors).toEqual(['Не слышу микрофон']);
    h.flow.reportError('Не слышу микрофон');
    await flush();
    expect(h.errors).toEqual(['Не слышу микрофон']);
  });
});

describe('wake-flow: щелчок по микрофону', () => {
  it('выключение щелчком и повторный щелчок снова включает разговор', () => {
    const h = makeHarness([]);
    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(true);
    expect(h.flow.conversationOwner()).toBe('pet');

    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(false);

    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(true);
    expect(h.flow.conversationOwner()).toBe('pet');
  });

  it('после выключения щелчком реплика в том же появлении разговор не включает', async () => {
    const h = makeHarness(['Тишка, привет'], voice({ talkByDefault: true }));
    h.bus.emit({ type: 'wake', source: 'click' });
    expect(h.flow.isConversation()).toBe(true);

    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(false);

    h.flow.handlePhrase(wav);
    await flush();
    expect(h.calls).toEqual(['привет']);
    expect(h.flow.isConversation()).toBe(false);
  });

  it('после нового появления автоматическое включение снова работает', () => {
    const h = makeHarness([], voice({ talkByDefault: true }));
    h.bus.emit({ type: 'wake', source: 'click' });
    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(false);

    h.bus.emit({ type: 'wake', source: 'click' });
    expect(h.flow.isConversation()).toBe(true);
  });

  it('щелчок ежа при владельце «чат» забирает разговор ежу', () => {
    const h = makeHarness([]);
    h.flow.enableConversation('chat');
    expect(h.flow.conversationOwner()).toBe('chat');

    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(true);
    expect(h.flow.conversationOwner()).toBe('pet');
  });

  it('при неготовой службе щелчок даёт сообщение и остаётся выключенным', () => {
    const h = makeHarness([], voice(), undefined, false);
    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(false);
    expect(h.errors).toContain('Распознавание речи не настроено');
    expect(h.commands).toContain('conversation-off');
  });
});

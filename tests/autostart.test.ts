import { describe, expect, it } from 'vitest';
import { HIDDEN_FLAG, loginItemSettings, startedHidden } from '../src/main/autostart';

describe('автозапуск', () => {
  it('аргумент --hidden означает старт свёрнутым', () => {
    expect(startedHidden(['tishka.exe', HIDDEN_FLAG])).toBe(true);
    expect(startedHidden(['tishka.exe'])).toBe(false);
  });

  it('настройка включает вход в систему с аргументом --hidden', () => {
    expect(loginItemSettings(true)).toEqual({ openAtLogin: true, args: [HIDDEN_FLAG] });
    expect(loginItemSettings(false)).toEqual({ openAtLogin: false, args: [HIDDEN_FLAG] });
  });
});

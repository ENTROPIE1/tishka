export const HIDDEN_FLAG = '--hidden';

// Аргумент автозапуска: приложение стартует свёрнутым в область уведомлений.
export function startedHidden(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_FLAG);
}

export interface LoginItemSettings {
  openAtLogin: boolean;
  args: string[];
}

export function loginItemSettings(enabled: boolean): LoginItemSettings {
  return { openAtLogin: enabled, args: [HIDDEN_FLAG] };
}

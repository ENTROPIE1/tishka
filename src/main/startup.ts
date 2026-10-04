import type { MainScreen } from './chat-window';

export type StartupAction = 'nothing' | 'stand' | 'chat' | 'pet';

export interface StartupInput {
  hidden: boolean;          // запуск вместе с Windows, свёрнутым
  stand: boolean;           // стенд персонажа
  hasGatewayKey: boolean;   // ключ шлюза уже задан
}

// Что показать при запуске: скрытый автозапуск — ничего, стенд — стенд,
// с ключом шлюза — ёж со строкой ввода, без ключа — окно «Подключения».
export function startupAction(input: StartupInput): StartupAction {
  if (input.hidden) {
    return 'nothing';
  }
  if (input.stand) {
    return 'stand';
  }
  return input.hasGatewayKey ? 'pet' : 'chat';
}

export interface StartupDeps {
  hidden: boolean;
  stand: boolean;
  hasGatewayKey(): Promise<boolean>;
  openStand(): void;
  openChat(screen: MainScreen): void;
  openPet(): void;
}

export async function runStartup(deps: StartupDeps): Promise<void> {
  const action = startupAction({
    hidden: deps.hidden,
    stand: deps.stand,
    hasGatewayKey: await deps.hasGatewayKey()
  });
  if (action === 'stand') {
    deps.openStand();
  } else if (action === 'chat') {
    deps.openChat('connections');
  } else if (action === 'pet') {
    deps.openPet();
  }
}

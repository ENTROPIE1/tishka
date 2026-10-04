import { Menu, Tray, nativeImage } from 'electron';

// Маленький значок Тишки: оранжевый круг, встроен, чтобы не зависеть от файлов.
const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAXYEir7HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCRiDcGrmZAhRGkmFQAAhLtOnB9Qr7AAAAAASUVORK5CYII=';

export interface PetTrayDeps {
  wake(): void;
  openChat(): void;
  openSettings(): void;
  openStand(): void;
  getPetMode(): boolean;
  setPetMode(value: boolean): void;
  getWakeEnabled(): boolean;
  setWakeEnabled(value: boolean): void;
  isWakeListening(): boolean;
  quit(): void;
}

export interface PetTray {
  refresh(): void;
  destroy(): void;
}

export function createPetTray(deps: PetTrayDeps): PetTray {
  const tray = new Tray(nativeImage.createFromDataURL(ICON_DATA_URL));

  const menu = Menu.buildFromTemplate([
    { label: 'Позвать Тишку', click: () => deps.wake() },
    { label: 'Открыть чат', click: () => deps.openChat() },
    { label: 'Стенд персонажа', click: () => deps.openStand() },
    { label: 'Подключения', click: () => deps.openSettings() },
    { type: 'separator' },
    {
      id: 'pet-mode',
      label: 'Режим питомца',
      type: 'checkbox',
      checked: deps.getPetMode(),
      click: (item) => deps.setPetMode(item.checked)
    },
    {
      id: 'wake-enabled',
      label: 'Откликаться на имя',
      type: 'checkbox',
      checked: deps.getWakeEnabled(),
      click: (item) => deps.setWakeEnabled(item.checked)
    },
    { type: 'separator' },
    { label: 'Выход', click: () => deps.quit() }
  ]);

  tray.setContextMenu(menu);

  function refresh(): void {
    const petMode = menu.getMenuItemById('pet-mode');
    const wakeEnabled = menu.getMenuItemById('wake-enabled');
    if (petMode !== null) {
      petMode.checked = deps.getPetMode();
    }
    if (wakeEnabled !== null) {
      wakeEnabled.checked = deps.getWakeEnabled();
    }
    tray.setToolTip(deps.isWakeListening() ? 'Тишка — слушает имя' : 'Тишка');
  }

  refresh();

  return {
    refresh,
    destroy(): void {
      tray.destroy();
    }
  };
}

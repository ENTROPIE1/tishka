import { Menu, Tray, nativeImage } from 'electron';

// Маленький значок Тишки: оранжевый круг, встроен, чтобы не зависеть от файлов.
const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAXYEir7HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCRiDcGrmZAhRGkmFQAAhLtOnB9Qr7AAAAAASUVORK5CYII=';

export interface PetTrayDeps {
  wake(): void;
  openChat(): void;
  openSettings(): void;
  getPetMode(): boolean;
  setPetMode(value: boolean): void;
  quit(): void;
}

export function createPetTray(deps: PetTrayDeps): Tray {
  const tray = new Tray(nativeImage.createFromDataURL(ICON_DATA_URL));
  tray.setToolTip('Тишка');

  const menu = Menu.buildFromTemplate([
    { label: 'Позвать Тишку', click: () => deps.wake() },
    { label: 'Открыть чат', click: () => deps.openChat() },
    { label: 'Подключения', click: () => deps.openSettings() },
    { type: 'separator' },
    {
      label: 'Режим питомца',
      type: 'checkbox',
      checked: deps.getPetMode(),
      click: (item) => deps.setPetMode(item.checked)
    },
    { type: 'separator' },
    { label: 'Выход', click: () => deps.quit() }
  ]);

  tray.setContextMenu(menu);
  return tray;
}

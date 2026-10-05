import type { PetLayoutView } from '../../pet/layout';

// Сторону раскладки окно получает из главного процесса и задаёт классом на
// корне. Размеры персонажа приходят там же: высота нового Тишки больше, и от
// неё зависят высота фигуры и подъём облачка к мордочке.
export function applyPetLayout(root: HTMLElement, layout: PetLayoutView): void {
  root.classList.toggle('mirrored', layout.mirrored);
  if (layout.petWidth !== undefined) {
    root.style.setProperty('--pet-width', `${layout.petWidth}px`);
  }
  if (layout.petHeight !== undefined) {
    root.style.setProperty('--pet-height', `${layout.petHeight}px`);
  }
  if (layout.muzzle !== undefined) {
    root.style.setProperty('--pet-muzzle', `${layout.muzzle}px`);
  }
}

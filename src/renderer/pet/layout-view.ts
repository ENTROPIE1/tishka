import type { PetLayoutView } from '../../pet/layout';

// Сторону раскладки окно получает из главного процесса и задаёт классом на
// корне. Размеры частей уже зашиты в ширину окна и разложены через flex.
export function applyPetLayout(root: HTMLElement, layout: PetLayoutView): void {
  root.classList.toggle('mirrored', layout.mirrored);
}

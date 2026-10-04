import type { TishkaEvent } from './types';

// Инструменты просмотра экрана: их начало и конец говорят окнам,
// смотрит ли Тишка сейчас на экран.
export const SCREEN_LOOK_TOOLS = new Set<string>(['screen_look', 'screen_shot']);

// Состояние «смотрит на экран» по событиям шины: вид — источник события,
// а не локальное состояние кнопки. Простой страхует потерянный конец инструмента.
export function nextScreenLooking(looking: boolean, event: TishkaEvent): boolean {
  if (event.type === 'tool.start' && SCREEN_LOOK_TOOLS.has(event.tool)) {
    return true;
  }
  if (event.type === 'tool.end' && SCREEN_LOOK_TOOLS.has(event.tool)) {
    return false;
  }
  if (event.type === 'idle') {
    return false;
  }
  return looking;
}

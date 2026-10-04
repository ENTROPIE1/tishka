import { prepareCleanup } from './cleanup';
import { prepareDateTimes } from './date-time';
import { prepareLatin } from './latin';
import { prepareNumbers } from './numbers';

const MAX_LENGTH = 400;

function finalize(text: string): string {
  let out = text.replace(/[^А-Яа-яЁё .,!?-]+/g, ' ');
  out = out.replace(/\s+([.,!?])/g, '$1');
  out = out.replace(/([.,!?])[.,!?]+/g, '$1');
  out = out.replace(/^[\s.,!?-]+/, '');
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out.trim();
}

function truncate(text: string): string {
  if (text.length <= MAX_LENGTH) {
    return text;
  }
  const window = text.slice(0, MAX_LENGTH);
  const boundary = Math.max(window.lastIndexOf('.'), window.lastIndexOf('!'), window.lastIndexOf('?'));
  if (boundary > 0) {
    return window.slice(0, boundary + 1).trim();
  }
  const space = window.lastIndexOf(' ');
  return (space > 0 ? window.slice(0, space) : window).trim();
}

// Готовит текст реплики к синтезу: числа и время словами, латиница по-русски,
// разметка и служебные знаки убраны. В облачке и в чате текст остаётся как есть.
export function prepareForSpeech(text: string): string {
  const cleaned = prepareCleanup(text);
  const withDates = prepareDateTimes(cleaned);
  const withNumbers = prepareNumbers(withDates);
  const withLatin = prepareLatin(withNumbers);
  return truncate(finalize(withLatin));
}

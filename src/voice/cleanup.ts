const URL_SOURCE = '(?:https?:\\/\\/|www\\.)[^\\s<>()]+';

// Ссылка после двоеточия или в конце фразы заменяется на «, ссылка»;
// в конце фразы добавляется точка. Иначе — просто «ссылка».
function linkReplacement(match: string, offset: number, whole: string, afterColon: boolean): string {
  const after = whole.slice(offset + match.length);
  const endsPhrase = /^[.!?]*\s*$/.test(after);
  if (afterColon || endsPhrase) {
    return endsPhrase ? ', ссылка.' : ', ссылка';
  }
  return 'ссылка';
}

export function prepareCleanup(text: string): string {
  let out = text;
  out = out.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1');
  out = out.replace(
    new RegExp(`:\\s*${URL_SOURCE}`, 'gi'),
    (match: string, offset: number, whole: string) => linkReplacement(match, offset, whole, true)
  );
  out = out.replace(
    new RegExp(URL_SOURCE, 'gi'),
    (match: string, offset: number, whole: string) => linkReplacement(match, offset, whole, false)
  );
  out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 'адрес почты');
  out = out.replace(/`+/g, ' ');
  out = out.replace(/\*\*|__/g, ' ');
  out = out.replace(/[*_#]/g, ' ');
  out = out.replace(/^[ \t]*[-+][ \t]+/gm, '');
  out = out.replace(/\(([^)]*)\)/g, (_match: string, inner: string) => (inner.length > 40 ? ' ' : ` ${inner} `));
  out = out.replace(/\p{Extended_Pictographic}/gu, ' ');
  out = out.replace(/[\u200D\uFE0F]/g, ' ');
  out = out.replace(/№/g, ' номер ');
  out = out.replace(/&/g, ' и ');
  out = out.replace(/—/g, ' , ');
  out = out.replace(/(\d)[ \t]*\+[ \t]*(\d)/g, '$1 плюс $2');
  out = out.replace(/([А-Яа-яЁё]+)[ \t]*\/[ \t]*([А-Яа-яЁё]+)/g, '$1 или $2');
  out = out.replace(/[ \t]*\n+[ \t]*/g, '. ');
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out;
}

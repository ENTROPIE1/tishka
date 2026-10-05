// Короткое описание действия меняющего инструмента для вопроса человеку.
// Аргументы пересказываются без секретов: значения подозрительных полей убираются.

const MAX_ACTION_LENGTH = 300;
const SECRET_KEY = /(secret|token|password|passwd|pwd|apikey|api[_-]?key|authorization|auth|credential)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Рекурсивно убирает значения похожих на секрет полей: в вопрос они не попадают.
export function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubSecrets(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? '***' : scrubSecrets(item);
  }
  return result;
}

function truncate(text: string): string {
  return text.length > MAX_ACTION_LENGTH ? `${text.slice(0, MAX_ACTION_LENGTH - 1)}…` : text;
}

// «инструмент jira__create с аргументами {...}» — не длиннее 300 знаков.
export function describeAction(tool: string, args: Record<string, unknown>): string {
  const scrubbed = scrubSecrets(args);
  const json = JSON.stringify(scrubbed) ?? '{}';
  const raw = json === '{}' ? `инструмент ${tool}` : `инструмент ${tool} с аргументами ${json}`;
  return truncate(raw);
}

// Строка вопроса для облачка ежа и ленты чата.
export function confirmQuestion(action: string, connection: string): string {
  return `Выполнить ${action} через ${connection}?`;
}

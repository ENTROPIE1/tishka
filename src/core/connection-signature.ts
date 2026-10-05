import { createHash } from 'node:crypto';

// Подпись подключения для сравнения настроек: хеш SHA-256 от подготовленной
// конфигурации и раскрытых секретов. Секреты в подписи не хранятся — только хеш,
// поэтому журналы и память не видят значение секрета.
export function connectionSignature(prepared: unknown, resolved?: unknown): string {
  const value = resolved === undefined ? { prepared } : { prepared, resolved };
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

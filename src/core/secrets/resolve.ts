import type { SecretStore } from '../types';

const SECRET_PATTERN = /\$\{secret:([^}]+)\}/g;

async function resolveValue(value: string, store: SecretStore): Promise<string> {
  const names = [...value.matchAll(SECRET_PATTERN)].map((match) => match[1]);
  let result = value;
  for (const name of names) {
    const secret = await store.get(name);
    if (secret === undefined) {
      throw new Error(`Секрет не найден: ${name}`);
    }
    result = result.split(`\${secret:${name}}`).join(secret);
  }
  return result;
}

export async function resolveSecrets(
  record: Record<string, string>,
  store: SecretStore
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = await resolveValue(value, store);
  }
  return result;
}

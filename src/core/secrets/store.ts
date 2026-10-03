import { readFile, rename, writeFile } from 'node:fs/promises';
import type { SecretStore } from '../types';

export interface SecretCrypto {
  encrypt(text: string): Buffer;
  decrypt(buffer: Buffer): string;
  available(): boolean;
}

export class SecretsUnavailableError extends Error {
  constructor() {
    super('Хранилище секретов недоступно: шифрование не поддерживается');
    this.name = 'SecretsUnavailableError';
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === 'string');
}

export function createSecretStore(filePath: string, crypto: SecretCrypto): SecretStore {
  async function readRecord(): Promise<Record<string, string>> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(filePath);
    } catch {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(crypto.decrypt(encrypted));
      return isStringRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async function writeRecord(record: Record<string, string>): Promise<void> {
    const encrypted = crypto.encrypt(JSON.stringify(record));
    const temporary = `${filePath}.tmp`;
    await writeFile(temporary, encrypted);
    await rename(temporary, filePath);
  }

  return {
    async set(name: string, value: string): Promise<void> {
      if (!crypto.available()) {
        throw new SecretsUnavailableError();
      }
      const record = await readRecord();
      record[name] = value;
      await writeRecord(record);
    },
    async get(name: string): Promise<string | undefined> {
      const record = await readRecord();
      return record[name];
    },
    async has(name: string): Promise<boolean> {
      const record = await readRecord();
      return Object.prototype.hasOwnProperty.call(record, name);
    },
    async delete(name: string): Promise<void> {
      const record = await readRecord();
      if (!Object.prototype.hasOwnProperty.call(record, name)) {
        return;
      }
      delete record[name];
      await writeRecord(record);
    },
    async names(): Promise<string[]> {
      const record = await readRecord();
      return Object.keys(record);
    }
  };
}

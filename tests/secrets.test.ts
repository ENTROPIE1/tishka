import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn()
}));

import { readFile, rename, writeFile } from 'node:fs/promises';
import type { SecretStore } from '../src/core/types';
import { createSecretStore, SecretsUnavailableError, type SecretCrypto } from '../src/core/secrets/store';
import { resolveSecrets } from '../src/core/secrets/resolve';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedRename = vi.mocked(rename);

const files = new Map<string, Buffer>();
const filePath = 'C:/tishka-data/secrets.bin';

function fakeCrypto(available = true): SecretCrypto {
  return {
    encrypt(text: string): Buffer {
      return Buffer.from(`enc:${Buffer.from(text, 'utf8').toString('base64')}`, 'utf8');
    },
    decrypt(buffer: Buffer): string {
      const raw = buffer.toString('utf8');
      return Buffer.from(raw.slice('enc:'.length), 'base64').toString('utf8');
    },
    available(): boolean {
      return available;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  mockedReadFile.mockImplementation(async (path) => {
    const data = files.get(String(path));
    if (data === undefined) {
      throw new Error('ENOENT');
    }
    return data as never;
  });
  mockedWriteFile.mockImplementation(async (path, data) => {
    files.set(String(path), Buffer.from(data as Buffer));
    return undefined as never;
  });
  mockedRename.mockImplementation(async (from, to) => {
    const data = files.get(String(from));
    files.delete(String(from));
    if (data !== undefined) {
      files.set(String(to), data);
    }
    return undefined as never;
  });
});

describe('createSecretStore', () => {
  it('сохраняет и читает секрет', async () => {
    const store = createSecretStore(filePath, fakeCrypto());
    await store.set('DKS_API_KEY', 'top-secret-value');

    expect(await store.get('DKS_API_KEY')).toBe('top-secret-value');
    expect(await store.has('DKS_API_KEY')).toBe(true);
    expect(await store.names()).toEqual(['DKS_API_KEY']);
  });

  it('не пишет открытое значение на диск', async () => {
    const store = createSecretStore(filePath, fakeCrypto());
    await store.set('DKS_API_KEY', 'top-secret-value');

    const onDisk = files.get(filePath);
    expect(onDisk).toBeDefined();
    expect(onDisk?.toString('utf8')).not.toContain('top-secret-value');
  });

  it('удаляет секрет', async () => {
    const store = createSecretStore(filePath, fakeCrypto());
    await store.set('A', '1');
    await store.delete('A');

    expect(await store.has('A')).toBe(false);
    expect(await store.names()).toEqual([]);
  });

  it('отклоняет запись при недоступном шифровании', async () => {
    const store = createSecretStore(filePath, fakeCrypto(false));

    await expect(store.set('A', '1')).rejects.toBeInstanceOf(SecretsUnavailableError);
    expect(files.size).toBe(0);
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });
});

describe('resolveSecrets', () => {
  let store: SecretStore;

  beforeEach(async () => {
    store = createSecretStore(filePath, fakeCrypto());
    await store.set('TOKEN', 'super-secret');
  });

  it('подставляет значение секрета', async () => {
    const resolved = await resolveSecrets(
      { Authorization: 'Bearer ${secret:TOKEN}', Plain: 'value' },
      store
    );
    expect(resolved.Authorization).toBe('Bearer super-secret');
    expect(resolved.Plain).toBe('value');
  });

  it('для неизвестного имени бросает ошибку с именем и без значений', async () => {
    let message = '';
    try {
      await resolveSecrets({ Authorization: 'Bearer ${secret:MISSING}' }, store);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('MISSING');
    expect(message).not.toContain('super-secret');
  });
});

describe('IPC секретов', () => {
  const ipcSource = readFileSync(new URL('../src/main/ipc.ts', import.meta.url), 'utf8');
  const channelsSource = readFileSync(new URL('../src/main/ipc-channels.ts', import.meta.url), 'utf8');

  it('не содержит канала, отдающего значение секрета', () => {
    expect(channelsSource).not.toMatch(/SECRETS_GET|secrets:get/i);
    expect(ipcSource).not.toMatch(/secrets\.get|SECRETS_GET|secrets:get/i);
  });

  it('регистрирует только set, has, delete, names', () => {
    expect(channelsSource).toContain('tishka:secrets:set');
    expect(channelsSource).toContain('tishka:secrets:has');
    expect(channelsSource).toContain('tishka:secrets:delete');
    expect(channelsSource).toContain('tishka:secrets:names');
  });
});

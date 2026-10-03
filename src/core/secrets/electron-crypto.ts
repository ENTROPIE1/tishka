import { safeStorage } from 'electron';
import type { SecretCrypto } from './store';

export const electronCrypto: SecretCrypto = {
  encrypt(text: string): Buffer {
    return safeStorage.encryptString(text);
  },
  decrypt(buffer: Buffer): string {
    return safeStorage.decryptString(buffer);
  },
  available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }
};

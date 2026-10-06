import { cpSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// В собранное приложение кладём только файлы персонажа: справочный
// проигрыватель и скрипт на Python (assets/tishka/model/reference) не нужны.
function copyModelAssets(): Plugin {
  return {
    name: 'tishka-copy-model',
    apply: 'build',
    closeBundle(): void {
      cpSync(resolve(__dirname, 'assets/tishka/model'), resolve(__dirname, 'out/renderer/model'), {
        recursive: true,
        filter: (source) => !source.split(sep).includes('reference')
      });
    }
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/preload.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'assets/tishka'),
    plugins: [copyModelAssets()],
    build: {
      copyPublicDir: false,
      rollupOptions: {
        input: {
          chat: resolve(__dirname, 'src/renderer/chat/index.html'),
          pet: resolve(__dirname, 'src/renderer/pet/index.html'),
          stand: resolve(__dirname, 'src/renderer/stand/index.html')
        }
      }
    }
  }
});

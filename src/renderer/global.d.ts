import type { TishkaApi } from '../main/preload';

declare global {
  interface Window {
    tishka: TishkaApi;
  }
}

export {};

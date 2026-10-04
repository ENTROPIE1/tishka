import type { WebContents } from 'electron';
import { extractFromDocument } from '../core/web/extract';

export const MAX_LINKS = 30;

export interface PageData {
  title: string;
  text: string;
  truncated: boolean;
  links: { text: string; url: string }[];
  hasPassword: boolean;
}

// Разметка разбирается на самой странице: туда уходит исходник чистой функции.
export async function extractPage(webContents: WebContents, maxChars: number): Promise<PageData | undefined> {
  const source = extractFromDocument.toString();
  const script = `(() => {
    const page = (${source})(document, ${maxChars}, ${MAX_LINKS});
    return {
      title: document.title || '',
      text: page.text,
      truncated: page.truncated,
      links: page.links,
      hasPassword: document.querySelector('input[type="password"]') !== null
    };
  })()`;
  try {
    const value = (await webContents.executeJavaScript(script, true)) as PageData;
    if (value.title === '') {
      value.title = webContents.getTitle();
    }
    return value;
  } catch {
    return undefined;
  }
}

export async function sendToBlank(webContents: WebContents): Promise<void> {
  try {
    await webContents.loadURL('about:blank');
  } catch {
    // Возврат на пустую страницу — уборка, её сбой чтению не мешает.
  }
}

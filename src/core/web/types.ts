export interface WebLink {
  text: string;
  url: string;
}

export interface WebPage {
  ok: true;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  links: WebLink[];
}

export type WebReadResult = WebPage | { ok: false; error: string };

export interface WebReadOptions {
  maxChars?: number;
  timeoutMs?: number;
}

export type WebReader = (url: string, options?: WebReadOptions) => Promise<WebReadResult>;

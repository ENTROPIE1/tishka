import type { WebReader } from '../web/types';

export interface WebToolsDeps {
  read?: WebReader;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

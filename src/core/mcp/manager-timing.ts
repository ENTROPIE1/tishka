import type { TimingDetails, TimingMark } from '../../main/timing-log';

export interface McpTiming {
  start(name: string, transport: string): number;
  ready(name: string, state: string, startedAt: number, extra?: TimingDetails): void;
}

// Отметки подключения серверов подключений в журнале времени.
export function createMcpTiming(mark?: TimingMark): McpTiming {
  return {
    start(name: string, transport: string): number {
      const at = Date.now();
      mark?.('mcp.server.start', { server: name, transport });
      return at;
    },
    ready(name: string, state: string, startedAt: number, extra: TimingDetails = {}): void {
      mark?.('mcp.server.ready', { server: name, state, ms: Date.now() - startedAt, ...extra });
    }
  };
}

import type { ConnectionTemplate } from '../core/connections';
import type { McpServerState } from '../core/mcp/manager';
import type { Config, McpServerConfig } from '../core/types';

export interface ConnectionSecretView {
  field: string;
  set: boolean;
}

export interface ConnectionView {
  name: string;
  template: ConnectionTemplate;
  fields: Record<string, string>;
  secrets: ConnectionSecretView[];
  state: McpServerState;
  tools: number;
  error?: string;
}

export type ConnectionPlanResult =
  | { ok: true; server: McpServerConfig }
  | { ok: false; errors: string[] };

export type ConnectionSaveResult = { ok: true } | { ok: false; errors: string[] };

export interface ConfigView {
  config: Config;
  gatewayKeySet: boolean;
}

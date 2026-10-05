import type { ConnectionTemplate } from '../core/connections';
import type { McpServerState } from '../core/mcp/manager';
import type { Config, McpServerConfig } from '../core/types';
import type { SttCheckView, SttDetector, SttStatus } from '../voice/stt-service';

export interface VoiceStateView {
  state: SttStatus;
  error?: string;
  detector?: SttDetector;   // встроенный детектор речи запущенной приложением службы
}

export type { SttCheckView };

export interface ConnectionSecretView {
  field: string;
  set: boolean;
}

export interface ConnectionView {
  name: string;
  template: ConnectionTemplate;
  address: string;
  fields: Record<string, string>;
  secrets: ConnectionSecretView[];
  state: McpServerState;
  tools: number;
  confirmChanges?: boolean;   // спрашивать человека перед меняющими инструментами (нет поля — да)
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

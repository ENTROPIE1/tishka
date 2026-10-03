import type { TishkaCore } from '../core/app';
import {
  describeConnection,
  planConnection,
  secretName,
  type ConnectionDraft,
  type ConnectionTemplate
} from '../core/connections';
import type { McpStatus } from '../core/mcp/manager';
import type { Config, McpServerConfig, SecretStore } from '../core/types';
import type {
  ConfigView,
  ConnectionPlanResult,
  ConnectionSaveResult,
  ConnectionView
} from './settings-types';

const API_KEY_SECRET = 'DKS_API_KEY';
const SECRET_REF_PATTERN = /\$\{secret:([^}]+)\}/g;

function secretNamesOf(server: McpServerConfig): string[] {
  const values = server.transport === 'http' ? Object.values(server.headers ?? {}) : Object.values(server.env ?? {});
  const names = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(SECRET_REF_PATTERN)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

function secretRef(name: string): string {
  return `\${secret:${name}}`;
}

function asDraft(value: unknown): ConnectionDraft {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const fields = typeof record['fields'] === 'object' && record['fields'] !== null ? record['fields'] : {};
  const secrets = typeof record['secrets'] === 'object' && record['secrets'] !== null ? record['secrets'] : {};
  return {
    template: record['template'] as ConnectionTemplate,
    name: typeof record['name'] === 'string' ? record['name'] : '',
    fields: fields as Record<string, string>,
    secrets: secrets as Record<string, string>
  };
}

async function connectionViews(core: TishkaCore, secrets: SecretStore): Promise<ConnectionView[]> {
  const statuses = new Map(core.mcpStatus().map((status) => [status.name, status]));
  const views: ConnectionView[] = [];
  for (const server of core.config().mcpServers) {
    const described = describeConnection(server);
    const secretViews = [];
    for (const field of described.secretNames) {
      secretViews.push({ field, set: await secrets.has(secretName(server.name, field)) });
    }
    const status = statuses.get(server.name);
    const view: ConnectionView = {
      name: server.name,
      template: described.template,
      fields: described.fields,
      secrets: secretViews,
      state: status?.state ?? 'disabled',
      tools: status?.tools ?? 0
    };
    if (status?.error !== undefined) {
      view.error = status.error;
    }
    views.push(view);
  }
  return views;
}

// При переименовании секреты переезжают на новые имена, а старые удаляются.
async function migrateSecrets(
  previousName: string | undefined,
  draft: ConnectionDraft,
  planSecrets: Record<string, string>,
  oldServer: McpServerConfig | undefined,
  secrets: SecretStore
): Promise<void> {
  for (const [name, value] of Object.entries(planSecrets)) {
    await secrets.set(name, value);
  }
  if (previousName === undefined || previousName === draft.name || oldServer === undefined) {
    return;
  }
  const described = describeConnection(oldServer);
  for (const field of described.secretNames) {
    const target = secretName(draft.name, field);
    const source = secretName(previousName, field);
    if (planSecrets[target] === undefined) {
      const value = await secrets.get(source);
      if (value !== undefined && value.length > 0) {
        await secrets.set(target, value);
      }
    }
    await secrets.delete(source);
  }
}

// Пустые секреты не перезаписываются, поэтому ссылки custom-stdio на прежние
// переменные окружения восстанавливаются из старого сервера.
function preserveStdioEnv(
  server: McpServerConfig,
  draft: ConnectionDraft,
  oldServer: McpServerConfig | undefined
): McpServerConfig {
  if (server.transport !== 'stdio' || draft.template !== 'custom-stdio' || oldServer === undefined) {
    return server;
  }
  if (oldServer.transport !== 'stdio') {
    return server;
  }
  const described = describeConnection(oldServer);
  if (described.template !== 'custom-stdio') {
    return server;
  }
  const env = { ...(server.env ?? {}) };
  for (const field of described.secretNames) {
    if (env[field] !== undefined) {
      continue;
    }
    env[field] = secretRef(secretName(draft.name, field));
  }
  return Object.keys(env).length > 0 ? { ...server, env } : server;
}

export async function configView(core: TishkaCore, secrets: SecretStore): Promise<ConfigView> {
  const fromEnv = process.env[API_KEY_SECRET] ?? '';
  const gatewayKeySet = (await secrets.has(API_KEY_SECRET)) || fromEnv.length > 0;
  return { config: core.config(), gatewayKeySet };
}

export function statusViews(core: TishkaCore, secrets: SecretStore): Promise<ConnectionView[]> {
  return connectionViews(core, secrets);
}

export function planDraft(core: TishkaCore, value: unknown): ConnectionPlanResult {
  const draft = asDraft(value);
  const existingNames = core.config().mcpServers.map((server) => server.name);
  const planned = planConnection(draft, existingNames);
  return planned.ok ? { ok: true, server: planned.plan.server } : { ok: false, errors: planned.errors };
}

export async function saveConnection(
  core: TishkaCore,
  secrets: SecretStore,
  value: unknown,
  previous: unknown
): Promise<ConnectionSaveResult> {
  const draft = asDraft(value);
  const previousName = typeof previous === 'string' && previous.length > 0 ? previous : undefined;
  const config = core.config();
  const existingNames = config.mcpServers.map((server) => server.name).filter((name) => name !== previousName);
  const planned = planConnection(draft, existingNames);
  if (!planned.ok) {
    return { ok: false, errors: planned.errors };
  }

  const oldServer = previousName === undefined
    ? undefined
    : config.mcpServers.find((server) => server.name === previousName);
  await migrateSecrets(previousName, draft, planned.plan.secretsToSet, oldServer, secrets);

  const server = preserveStdioEnv(planned.plan.server, draft, oldServer);
  const servers = config.mcpServers.filter((item) => item.name !== previousName && item.name !== draft.name);
  servers.push(server);
  await core.saveConfig({ ...config, mcpServers: servers });
  return { ok: true };
}

export async function removeConnection(core: TishkaCore, secrets: SecretStore, value: unknown): Promise<void> {
  const name = typeof value === 'string' ? value : '';
  const config = core.config();
  const server = config.mcpServers.find((item) => item.name === name);
  if (server === undefined) {
    return;
  }
  for (const secret of secretNamesOf(server)) {
    await secrets.delete(secret);
  }
  await core.saveConfig({
    ...config,
    mcpServers: config.mcpServers.filter((item) => item.name !== name)
  });
}

export async function reconnectConnection(core: TishkaCore, value: unknown): Promise<McpStatus | undefined> {
  const name = typeof value === 'string' ? value : '';
  return core.reconnect(name);
}

export async function saveConfigValue(core: TishkaCore, value: unknown): Promise<void> {
  await core.saveConfig(value as Config);
}

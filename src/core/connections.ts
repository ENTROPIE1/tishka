import type { McpServerConfig } from './types';

export type ConnectionTemplate = 'confluence' | 'exchange' | 'custom-stdio' | 'custom-http';

export interface ConnectionDraft {
  template: ConnectionTemplate;
  name: string;                               // имя подключения: латиница, цифры, дефис, от 1 до 32 знаков
  fields: Record<string, string>;             // несекретные поля: адрес, логин, команда, аргументы
  secrets: Record<string, string>;            // секретные поля; пустое значение — прежний секрет сохраняется
  confirmChanges?: boolean;                   // спрашивать перед изменениями; нет поля — да
}

export interface ConnectionPlan {
  server: McpServerConfig;
  secretsToSet: Record<string, string>;       // имя секрета → значение
}

const TEMPLATES: readonly ConnectionTemplate[] = ['confluence', 'exchange', 'custom-stdio', 'custom-http'];
const CONFLUENCE_SCRIPT = 'mcp-servers/confluence/dist/index.js';
const EXCHANGE_SCRIPT = 'mcp-servers/exchange/dist/index.js';
const NAME_PATTERN = /^[A-Za-z0-9-]+$/;
const MAX_NAME_LENGTH = 32;
const SECRET_MARKER = '${secret:';

export function secretName(serverName: string, field: string): string {
  return `${serverName}_${field}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function secretRef(name: string): string {
  return `${SECRET_MARKER}${name}}`;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isSecretRef(value: string): boolean {
  return value.includes(SECRET_MARKER);
}

function fieldValue(fields: Record<string, string>, key: string): string {
  return fields[key] ?? '';
}

// Пробелы и переводы строк по краям при вставке — частая ошибка, поэтому
// значения очищаются здесь, до проверки и до сборки сервера.
function trimRecord(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = typeof value === 'string' ? value.trim() : value;
  }
  return result;
}

function cleanDraft(draft: ConnectionDraft): ConnectionDraft {
  const clean: ConnectionDraft = {
    template: draft.template,
    name: typeof draft.name === 'string' ? draft.name.trim() : draft.name,
    fields: trimRecord(draft.fields),
    secrets: trimRecord(draft.secrets)
  };
  if (typeof draft.confirmChanges === 'boolean') {
    clean.confirmChanges = draft.confirmChanges;
  }
  return clean;
}

function addUrlError(errors: string[], value: string, emptyMessage: string): void {
  if (value.length === 0) {
    errors.push(emptyMessage);
  } else if (!isHttpUrl(value)) {
    errors.push('Адрес должен начинаться с http:// или https://');
  }
}

function nameErrors(draft: ConnectionDraft, existingNames: string[]): string | undefined {
  if (draft.name.length === 0) {
    return 'Укажите имя сервера';
  }
  if (!NAME_PATTERN.test(draft.name)) {
    return 'Имя может содержать только латиницу, цифры и дефис';
  }
  if (draft.name.length > MAX_NAME_LENGTH) {
    return `Имя не может быть длиннее ${MAX_NAME_LENGTH} знаков`;
  }
  if (existingNames.includes(draft.name)) {
    return `Имя «${draft.name}» уже занято`;
  }
  return undefined;
}

function templateErrors(draft: ConnectionDraft): string[] {
  const errors: string[] = [];
  switch (draft.template) {
    case 'confluence':
      addUrlError(errors, fieldValue(draft.fields, 'url'), 'Укажите адрес');
      break;
    case 'exchange':
      addUrlError(errors, fieldValue(draft.fields, 'ewsUrl'), 'Укажите адрес EWS');
      addUrlError(errors, fieldValue(draft.fields, 'owaUrl'), 'Укажите адрес OWA');
      if (fieldValue(draft.fields, 'user').length === 0) {
        errors.push('Укажите имя пользователя');
      }
      break;
    case 'custom-stdio':
      if (fieldValue(draft.fields, 'command').length === 0) {
        errors.push('Укажите команду');
      }
      break;
    case 'custom-http':
      addUrlError(errors, fieldValue(draft.fields, 'url'), 'Укажите адрес');
      break;
  }
  return errors;
}

type StdioServer = Extract<McpServerConfig, { transport: 'stdio' }>;
type HttpServer = Extract<McpServerConfig, { transport: 'http' }>;

function buildConfluence(draft: ConnectionDraft, secretsToSet: Record<string, string>): StdioServer {
  const secret = secretName(draft.name, 'token');
  const value = draft.secrets.token ?? '';
  if (value.length > 0) {
    secretsToSet[secret] = value;
  }
  return {
    name: draft.name,
    transport: 'stdio',
    command: 'node',
    args: [CONFLUENCE_SCRIPT],
    env: {
      CONFLUENCE_URL: fieldValue(draft.fields, 'url'),
      CONFLUENCE_TOKEN: secretRef(secret)
    }
  };
}

function buildExchange(draft: ConnectionDraft, secretsToSet: Record<string, string>): StdioServer {
  const secret = secretName(draft.name, 'password');
  const value = draft.secrets.password ?? '';
  if (value.length > 0) {
    secretsToSet[secret] = value;
  }
  return {
    name: draft.name,
    transport: 'stdio',
    command: 'node',
    args: [EXCHANGE_SCRIPT],
    env: {
      EXCHANGE_EWS_URL: fieldValue(draft.fields, 'ewsUrl'),
      EXCHANGE_OWA_URL: fieldValue(draft.fields, 'owaUrl'),
      EXCHANGE_USER: fieldValue(draft.fields, 'user'),
      EXCHANGE_PASSWORD: secretRef(secret)
    }
  };
}

function buildCustomStdio(draft: ConnectionDraft, secretsToSet: Record<string, string>): StdioServer {
  const server: StdioServer = {
    name: draft.name,
    transport: 'stdio',
    command: fieldValue(draft.fields, 'command')
  };
  const args = fieldValue(draft.fields, 'args').trim().split(/\s+/).filter((part) => part.length > 0);
  if (args.length > 0) {
    server.args = args;
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft.secrets)) {
    if (key.length === 0 || value.length === 0) {
      continue;
    }
    const secret = secretName(draft.name, key);
    env[key] = secretRef(secret);
    secretsToSet[secret] = value;
  }
  if (Object.keys(env).length > 0) {
    server.env = env;
  }
  return server;
}

function buildCustomHttp(draft: ConnectionDraft, secretsToSet: Record<string, string>): HttpServer {
  const server: HttpServer = {
    name: draft.name,
    transport: 'http',
    url: fieldValue(draft.fields, 'url')
  };
  const value = draft.secrets.authorization ?? '';
  if (value.length > 0) {
    const secret = secretName(draft.name, 'authorization');
    server.headers = { Authorization: secretRef(secret) };
    secretsToSet[secret] = value;
  }
  return server;
}

function buildServer(draft: ConnectionDraft): ConnectionPlan {
  const secretsToSet: Record<string, string> = {};
  let server: McpServerConfig;
  switch (draft.template) {
    case 'exchange':
      server = buildExchange(draft, secretsToSet);
      break;
    case 'custom-stdio':
      server = buildCustomStdio(draft, secretsToSet);
      break;
    case 'custom-http':
      server = buildCustomHttp(draft, secretsToSet);
      break;
    default:
      server = buildConfluence(draft, secretsToSet);
      break;
  }
  const withConfirm =
    draft.confirmChanges === undefined ? server : { ...server, confirmChanges: draft.confirmChanges };
  return { server: withConfirm, secretsToSet };
}

export function planConnection(
  draft: ConnectionDraft,
  existingNames: string[]
): { ok: true; plan: ConnectionPlan } | { ok: false; errors: string[] } {
  const clean = cleanDraft(draft);
  const errors: string[] = [];
  if (!TEMPLATES.includes(clean.template)) {
    errors.push('Неизвестный шаблон подключения');
  }
  const nameError = nameErrors(clean, existingNames);
  if (nameError !== undefined) {
    errors.push(nameError);
  }
  errors.push(...templateErrors(clean));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, plan: buildServer(clean) };
}

function matchesScript(args: string[], script: string): boolean {
  return args.some((arg) => arg.replace(/\\/g, '/').endsWith(script));
}

export function describeConnection(server: McpServerConfig): {
  template: ConnectionTemplate;
  fields: Record<string, string>;
  secretNames: string[];
} {
  if (server.transport === 'http') {
    const authorization = server.headers?.Authorization ?? '';
    return {
      template: 'custom-http',
      fields: { url: server.url },
      secretNames: isSecretRef(authorization) ? ['authorization'] : []
    };
  }
  const args = server.args ?? [];
  if (matchesScript(args, CONFLUENCE_SCRIPT)) {
    return {
      template: 'confluence',
      fields: { url: server.env?.CONFLUENCE_URL ?? '' },
      secretNames: ['token']
    };
  }
  if (matchesScript(args, EXCHANGE_SCRIPT)) {
    return {
      template: 'exchange',
      fields: {
        ewsUrl: server.env?.EXCHANGE_EWS_URL ?? '',
        owaUrl: server.env?.EXCHANGE_OWA_URL ?? '',
        user: server.env?.EXCHANGE_USER ?? ''
      },
      secretNames: ['password']
    };
  }
  const env = server.env ?? {};
  return {
    template: 'custom-stdio',
    fields: { command: server.command, args: args.join(' ') },
    secretNames: Object.keys(env).filter((key) => isSecretRef(env[key]))
  };
}

function joinParts(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join(' ');
}

// То, по чему человек различает подключения к одной системе. Секреты сюда не
// попадают: describeConnection возвращает только несекретные поля.
export function connectionAddress(server: McpServerConfig): string {
  const described = describeConnection(server);
  switch (described.template) {
    case 'exchange':
      return joinParts([described.fields.owaUrl ?? '', described.fields.user ?? '']);
    case 'custom-stdio':
      return joinParts([described.fields.command ?? '', described.fields.args ?? '']);
    default:
      return described.fields.url ?? '';
  }
}

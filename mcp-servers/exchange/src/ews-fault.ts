import { XMLParser } from 'fast-xml-parser';

export interface EwsAuth {
  user: string;
  password: string;
}

const FAULT_LIMIT = 300;
const SECRET_PLACEHOLDER = '[скрыто]';

const XML_PARSER = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

export function describeStatusError(
  response: { status: number; body: string },
  auth: EwsAuth
): string {
  const fault = readFault(response.body);
  const parts: string[] = [];
  if (fault.text !== '') {
    parts.push(truncate(sanitizeSecrets(fault.text, auth)));
  }
  if (fault.responseCode !== '') {
    parts.push(`ResponseCode: ${truncate(sanitizeSecrets(fault.responseCode, auth))}`);
  }
  if (parts.length === 0) {
    return `Exchange вернул статус ${response.status}`;
  }
  return `Exchange вернул статус ${response.status}: ${parts.join('; ')}`;
}

function readFault(body: string): { text: string; responseCode: string } {
  let parsed: RawFaultEnvelope;
  try {
    parsed = XML_PARSER.parse(body) as RawFaultEnvelope;
  } catch {
    return { text: '', responseCode: '' };
  }
  const fault = parsed.Envelope?.Body?.Fault;
  if (fault === undefined) {
    return { text: '', responseCode: '' };
  }
  return {
    text: nodeText(fault.faultstring) || nodeText(fault.Reason?.Text),
    responseCode: nodeText(fault.detail?.ResponseCode) || nodeText(fault.Detail?.ResponseCode)
  };
}

// С включёнными атрибутами узел с xml:lang приходит объектом с текстом в #text.
function nodeText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value !== null && typeof value === 'object' && '#text' in value) {
    const text = (value as { '#text'?: unknown })['#text'];
    return typeof text === 'string' ? text : '';
  }
  return '';
}

// сначала убираем секреты: обрезка не должна оставить часть пароля в тексте
function sanitizeSecrets(text: string, auth: EwsAuth): string {
  let result = text;
  if (auth.password.length > 0) {
    result = result.split(auth.password).join(SECRET_PLACEHOLDER);
  }
  if (auth.user.length > 0) {
    result = result.split(auth.user).join(SECRET_PLACEHOLDER);
  }
  return result;
}

function truncate(text: string): string {
  return text.slice(0, FAULT_LIMIT);
}

interface RawFault {
  faultstring?: unknown;
  Reason?: { Text?: unknown };
  detail?: { ResponseCode?: unknown };
  Detail?: { ResponseCode?: unknown };
}

interface RawFaultEnvelope {
  Envelope?: { Body?: { Fault?: RawFault } };
}

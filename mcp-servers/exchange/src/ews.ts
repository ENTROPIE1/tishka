import { XMLParser } from 'fast-xml-parser';
import httpntlm from 'httpntlm';
import { describeStatusError, type EwsAuth } from './ews-fault';

export type { EwsAuth } from './ews-fault';

export type EwsPost = (
  url: string,
  soapBody: string,
  auth: { user: string; password: string }
) => Promise<{ status: number; body: string }>;

export interface RawRootFolder {
  Items?: Record<string, unknown>;
  '@_TotalItemsInView'?: unknown;
}

export interface RawResponseMessage {
  ResponseCode?: unknown;
  RootFolder?: RawRootFolder;
  Items?: Record<string, unknown>;
}

export interface EwsTransport {
  call(soapBody: string, operation: string): Promise<RawResponseMessage>;
}

export const REQUEST_TIMEOUT_MS = 30_000;
const NO_ERROR = 'NoError';

const XML_PARSER = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

export function createEwsTransport(opts: {
  ewsUrl: string;
  user: string;
  password: string;
  post?: EwsPost;
}): EwsTransport {
  const post = opts.post ?? ntlmPost;
  const auth: EwsAuth = { user: opts.user, password: opts.password };
  return {
    async call(soapBody: string, operation: string): Promise<RawResponseMessage> {
      const response = await postWithTimeout(opts.ewsUrl, soapBody, auth, post);
      return readResponseMessage(response, auth, operation);
    }
  };
}

// сюда попадает и срабатывание таймаута: зависший запрос неотличим от отказа сети
async function postWithTimeout(
  url: string,
  soapBody: string,
  auth: EwsAuth,
  post: EwsPost
): Promise<{ status: number; body: string }> {
  try {
    return await withTimeout(post(url, soapBody, auth), REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw new Error('Почтовый сервер недоступен, проверьте VPN', { cause: error });
  }
}

function readResponseMessage(
  response: { status: number; body: string },
  auth: EwsAuth,
  operation: string
): RawResponseMessage {
  if (response.status === 401) {
    throw new Error('Exchange отклонил логин или пароль');
  }
  if (response.status !== 200) {
    throw new Error(describeStatusError(response, auth));
  }
  let parsed: RawEnvelope;
  try {
    parsed = XML_PARSER.parse(response.body) as RawEnvelope;
  } catch (error) {
    throw new Error('Exchange вернул некорректный ответ', { cause: error });
  }
  const operationResponse = parsed.Envelope?.Body?.[`${operation}Response`] as
    | { ResponseMessages?: Record<string, unknown> }
    | undefined;
  const message = asArray(
    operationResponse?.ResponseMessages?.[`${operation}ResponseMessage`] as
      | RawResponseMessage
      | RawResponseMessage[]
      | undefined
  )[0];
  if (message === undefined) {
    throw new Error('Exchange вернул некорректный ответ');
  }
  const code = asText(message.ResponseCode);
  if (code !== NO_ERROR) {
    throw new Error(`Exchange вернул код ошибки: ${code}`);
  }
  return message;
}

async function ntlmPost(
  url: string,
  soapBody: string,
  auth: EwsAuth
): Promise<{ status: number; body: string }> {
  const { domain, username } = splitUser(auth.user);
  const response = await new Promise<{ statusCode: number; body: string | Buffer }>(
    (resolve, reject) => {
      httpntlm.post(
        {
          url,
          username,
          password: auth.password,
          domain,
          body: soapBody,
          headers: { 'Content-Type': 'text/xml; charset=utf-8' },
          timeout: REQUEST_TIMEOUT_MS
        },
        (error, result) => {
          if (error !== null) {
            reject(error);
            return;
          }
          resolve(result);
        }
      );
    }
  );
  return { status: response.statusCode, body: asBodyText(response.body) };
}

export function splitUser(user: string): { domain: string; username: string } {
  const separator = user.indexOf('\\');
  if (separator === -1) {
    return { domain: '', username: user };
  }
  return { domain: user.slice(0, separator), username: user.slice(separator + 1) };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Превышен таймаут запроса')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function asBodyText(body: string | Buffer): string {
  return typeof body === 'string' ? body : body.toString('utf-8');
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asBool(value: unknown): boolean {
  return value === true || value === 'true';
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function toIso(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

interface RawEnvelope {
  Envelope?: { Body?: Record<string, unknown> };
}

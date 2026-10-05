import { expect } from 'vitest';
import { createMailClient, type ExchangeMail } from '../mcp-servers/exchange/src/mail';
import type { EwsPost } from '../mcp-servers/exchange/src/ews';

export const EWS_URL = 'https://mail.example.org/EWS/Exchange.asmx';
export const USER = 'DOMAIN\\ivan';
export const PASSWORD = 'secret-pass-1';
export const NO_MUTATION = ['CreateItem', 'UpdateItem', 'DeleteItem', 'MoveItem', 'SendItem'];

export interface CapturedPost {
  url: string;
  soapBody: string;
  auth: { user: string; password: string };
}

export function setup(bodies: string[]): { mail: ExchangeMail; calls: CapturedPost[] } {
  const calls: CapturedPost[] = [];
  let index = 0;
  const post: EwsPost = async (url, soapBody, auth) => {
    calls.push({ url, soapBody, auth });
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return { status: 200, body };
  };
  return { mail: createMailClient({ ewsUrl: EWS_URL, user: USER, password: PASSWORD, post }), calls };
}

export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mailItem(params: {
  id: string;
  subject: string;
  from: string;
  date?: string;
  body?: string;
  unread?: boolean;
  attachments?: boolean;
  conversationId?: string;
}): string {
  const id = `<t:ItemId Id="${params.id}" />`;
  const from = `<t:From><t:Mailbox><t:Name>${esc(params.from)}</t:Name><t:EmailAddress>a@example.org</t:EmailAddress></t:Mailbox></t:From>`;
  const date = `<t:DateTimeReceived>${params.date ?? '2026-10-06T08:00:00Z'}</t:DateTimeReceived>`;
  const body = params.body === undefined ? '' : `<t:Body>${esc(params.body)}</t:Body>`;
  const flags =
    `<t:IsRead>${params.unread === true ? 'false' : 'true'}</t:IsRead>` +
    `<t:HasAttachments>${params.attachments === true ? 'true' : 'false'}</t:HasAttachments>`;
  const conversation =
    params.conversationId === undefined ? '' : `<t:ConversationId Id="${params.conversationId}" />`;
  return (
    '<t:Message>' +
    id +
    `<t:Subject>${esc(params.subject)}</t:Subject>` +
    from +
    date +
    body +
    flags +
    conversation +
    '</t:Message>'
  );
}

export function findResponse(items: string, total?: number): string {
  const totalAttr = total === undefined ? '' : ` TotalItemsInView="${total}"`;
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <s:Body><m:FindItemResponse><m:ResponseMessages>
    <m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>
      <m:RootFolder${totalAttr}><t:Items>${items}</t:Items></m:RootFolder>
    </m:FindItemResponseMessage>
  </m:ResponseMessages></m:FindItemResponse></s:Body>
</s:Envelope>`;
}

export function getResponse(item: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <s:Body><m:GetItemResponse><m:ResponseMessages>
    <m:GetItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>
      <m:Items>${item}</m:Items>
    </m:GetItemResponseMessage>
  </m:ResponseMessages></m:GetItemResponse></s:Body>
</s:Envelope>`;
}

export async function catchError(promise: Promise<unknown>): Promise<Error> {
  const caught = await promise.catch((error: unknown) => error);
  expect(caught).toBeInstanceOf(Error);
  return caught as Error;
}

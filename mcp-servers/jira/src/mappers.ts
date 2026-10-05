import { jiraToText, preview } from './markup';
import type { JiraComment, JiraIssue, JiraIssueRef } from './types';

const DESCRIPTION_LIMIT = 6_000;
const COMMENT_PREVIEW = 300;

export interface RawFields {
  summary?: unknown;
  status?: unknown;
  issuetype?: unknown;
  priority?: unknown;
  assignee?: unknown;
  reporter?: unknown;
  created?: unknown;
  updated?: unknown;
  description?: unknown;
  comment?: { comments?: RawComment[] };
}

export interface RawIssue {
  key?: unknown;
  fields?: RawFields;
}

export interface RawComment {
  author?: unknown;
  created?: unknown;
  body?: unknown;
}

export interface RawCommentList {
  comments?: RawComment[];
}

export interface RawSearch {
  issues?: RawIssue[];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function named(value: unknown): string {
  return asText((value as { name?: unknown } | undefined)?.name);
}

function displayName(value: unknown): string {
  return asText((value as { displayName?: unknown } | undefined)?.displayName);
}

function sortComments(comments: RawComment[]): RawComment[] {
  return [...comments].sort((a, b) => asText(a.created).localeCompare(asText(b.created)));
}

export function toComment(raw: RawComment): JiraComment {
  return {
    author: displayName(raw.author),
    created: asText(raw.created),
    body: preview(jiraToText(asText(raw.body)), COMMENT_PREVIEW)
  };
}

export function toIssue(raw: RawIssue, baseUrl: string): JiraIssue {
  const fields = raw.fields ?? {};
  const description = jiraToText(asText(fields.description));
  const all = Array.isArray(fields.comment?.comments) ? (fields.comment?.comments as RawComment[]) : [];
  return {
    key: asText(raw.key),
    summary: asText(fields.summary),
    status: named(fields.status),
    type: named(fields.issuetype),
    priority: named(fields.priority),
    assignee: displayName(fields.assignee),
    reporter: displayName(fields.reporter),
    created: asText(fields.created),
    updated: asText(fields.updated),
    description: description.slice(0, DESCRIPTION_LIMIT),
    descriptionTruncated: description.length > DESCRIPTION_LIMIT,
    comments: sortComments(all).slice(-5).map(toComment),
    url: `${baseUrl}/browse/${asText(raw.key)}`
  };
}

export function toRef(raw: RawIssue, baseUrl: string): JiraIssueRef {
  const fields = raw.fields ?? {};
  return {
    key: asText(raw.key),
    summary: asText(fields.summary),
    status: named(fields.status),
    assignee: displayName(fields.assignee),
    updated: asText(fields.updated),
    url: `${baseUrl}/browse/${asText(raw.key)}`
  };
}

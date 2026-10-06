import type { JiraSearchParams } from './types';

export function escapeQuotes(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function buildJql(params: JiraSearchParams): string {
  const clauses: string[] = [];
  if (params.text !== undefined && params.text !== '') {
    clauses.push(`text ~ "${escapeQuotes(params.text)}"`);
  }
  if (params.project !== undefined && params.project !== '') {
    clauses.push(`project = "${escapeQuotes(params.project)}"`);
  }
  if (params.me === true) {
    clauses.push('assignee = currentUser()');
  } else if (params.assignee !== undefined && params.assignee !== '') {
    clauses.push(`assignee = "${escapeQuotes(params.assignee)}"`);
  }
  if (params.status !== undefined && params.status !== '') {
    clauses.push(`status = "${escapeQuotes(params.status)}"`);
  }
  if (params.updatedSince !== undefined && params.updatedSince !== '') {
    clauses.push(`updated >= "${escapeQuotes(params.updatedSince)}"`);
  }
  return clauses.join(' AND ');
}

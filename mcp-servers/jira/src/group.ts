import type { JiraIssueRef } from './types';

export function groupByStatus(issues: JiraIssueRef[]): {
  total: number;
  groups: { status: string; issues: JiraIssueRef[] }[];
} {
  const groups: { status: string; issues: JiraIssueRef[] }[] = [];
  for (const issue of issues) {
    const status = issue.status === '' ? 'Без статуса' : issue.status;
    const group = groups.find((item) => item.status === status);
    if (group === undefined) {
      groups.push({ status, issues: [issue] });
    } else {
      group.issues.push(issue);
    }
  }
  return { total: issues.length, groups };
}

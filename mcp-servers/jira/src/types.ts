export interface JiraComment {
  author: string;
  created: string;
  body: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  type: string;
  priority: string;
  assignee: string;
  reporter: string;
  created: string;
  updated: string;
  description: string;
  descriptionTruncated: boolean;
  comments: JiraComment[];
  url: string;
}

export interface JiraIssueRef {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  updated: string;
  url: string;
}

export interface JiraSearchParams {
  text?: string;
  project?: string;
  assignee?: string;
  me?: boolean;
  status?: string;
  updatedSince?: string;
  limit?: number;
}

export interface JiraClient {
  getIssue(key: string): Promise<JiraIssue>;
  getComments(key: string, limit?: number): Promise<JiraComment[]>;
  search(params: JiraSearchParams): Promise<JiraIssueRef[]>;
  searchByJql(jql: string, limit?: number): Promise<JiraIssueRef[]>;
  myIssues(limit?: number): Promise<JiraIssueRef[]>;
}

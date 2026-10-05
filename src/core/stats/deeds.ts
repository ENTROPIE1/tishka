import type { DeedKind } from '../types';

export interface DeedMatch {
  kind: DeedKind;
  title: string;
}

// Инструменты, завершение которых считается выполненным делом. Имя MCP-инструмента
// приходит с префиксом сервера, поэтому сверяем хвост после «__».
const TOOL_DEEDS: Record<string, DeedMatch> = {
  mail_draft_link: { kind: 'draft', title: 'Черновик письма' },
  meeting_draft_link: { kind: 'event', title: 'Событие календаря' },
  search_pages: { kind: 'page', title: 'Найдена страница' },
  get_page: { kind: 'page', title: 'Открыта страница' },
  wiki_search: { kind: 'page', title: 'Найден материал' },
  wiki_read: { kind: 'page', title: 'Прочитана страница' },
  web_read: { kind: 'page', title: 'Прочитана страница' }
};

function bareName(name: string): string {
  const separator = name.lastIndexOf('__');
  return separator === -1 ? name : name.slice(separator + 2);
}

export function classifyTool(name: string): DeedMatch | undefined {
  return TOOL_DEEDS[bareName(name)];
}

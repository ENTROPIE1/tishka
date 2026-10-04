import type { SkillOverview } from '../../../core/skills/overview';
import type { ConnectionView } from '../../../main/ipc-settings';
import { clear, el, sectionTitle } from '../../settings/dom';
import { createActions } from './card-actions';
import type { MyTabDeps } from './deps';
import { kindIcon, kindTitle, lastCheckText, nextText, runSummary } from './format';

export type { MyTabDeps } from './deps';

const CONNECTED = new Set(['connected']);

function cardState(entry: SkillOverview): { label: string; className: string } {
  if (entry.skill.enabled === false) {
    return { label: 'приостановлен', className: 'state-paused' };
  }
  if (entry.state.lastResult !== undefined && entry.state.lastResult !== 'ok') {
    return { label: 'ошибка', className: 'state-error' };
  }
  return { label: 'работает', className: 'state-active' };
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function needsRow(entry: SkillOverview, connections: ConnectionView[]): HTMLElement {
  const row = el('div', 'skill-needs');
  if (entry.description.needs.length === 0) {
    row.append(el('span', 'need need-none', 'ничего не нужно'));
    return row;
  }
  for (const name of entry.description.needs) {
    const view = connections.find((item) => sameName(item.name, name));
    const connected = view !== undefined && CONNECTED.has(view.state);
    row.append(el('span', `need ${connected ? 'need-ok' : 'need-missing'}`, name));
  }
  return row;
}

function metaLine(entry: SkillOverview, now: Date): string {
  const parts: string[] = [];
  const check = lastCheckText(entry.state, now);
  if (check !== undefined) {
    parts.push(`последняя проверка ${check}`);
  }
  const next = nextText(entry.state, now);
  if (next !== undefined) {
    parts.push(`следующая ${next}`);
  }
  parts.push(runSummary(entry.state, now));
  return parts.join(' · ');
}

function card(entry: SkillOverview, connections: ConnectionView[], deps: MyTabDeps, reload: () => void): HTMLElement {
  const now = new Date();
  const box = el('div', 'skill-card');
  box.dataset['skill'] = entry.skill.id;
  const head = el('div', 'skill-card-head');
  const icon = el('span', 'skill-kind', kindIcon(entry.description.kind));
  icon.title = kindTitle(entry.description.kind);
  const title = el('div', 'skill-titles');
  title.append(el('div', 'skill-name', entry.skill.name), el('div', 'skill-summary', entry.skill.description));
  const state = cardState(entry);
  head.append(icon, title, el('span', `skill-state ${state.className}`, state.label));
  box.append(head);
  box.append(el('div', 'skill-when', entry.description.when));
  const does = el('ul', 'skill-does');
  for (const line of entry.description.does) {
    does.append(el('li', undefined, line));
  }
  box.append(does, needsRow(entry, connections), el('div', 'skill-meta', metaLine(entry, now)));
  const message = el('div', 'skill-message');
  box.append(createActions(entry, deps, message, reload), message);
  return box;
}

function group(entries: SkillOverview[], connections: ConnectionView[], deps: MyTabDeps, reload: () => void): HTMLElement {
  const box = el('div', 'skill-group');
  for (const entry of entries) {
    box.append(card(entry, connections, deps, reload));
  }
  return box;
}

export function renderMyTab(
  container: HTMLElement,
  entries: SkillOverview[],
  connections: ConnectionView[],
  deps: MyTabDeps
): void {
  clear(container);
  const reload = deps.onChanged;
  const self = entries.filter((entry) => entry.description.kind !== 'phrase');
  const ask = entries.filter((entry) => entry.description.kind === 'phrase');

  if (entries.length === 0) {
    container.append(
      el('div', 'empty', 'Навыков пока нет. Скажите Тишке «научись…» или поставьте готовый на вкладке «Готовые»')
    );
    return;
  }

  if (self.length > 0) {
    container.append(sectionTitle('Работают сами'), group(self, connections, deps, reload));
  }
  if (ask.length > 0) {
    container.append(sectionTitle('По просьбе'), group(ask, connections, deps, reload));
  }
}

import type { Reply, StatsPeriod, StatsSummary, ToolDef, ToolRegistry } from '../types';

export interface StatsToolDeps {
  summary(): StatsSummary;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return few;
  }
  return many;
}

function deeds(count: number): string {
  return `${count} ${plural(count, 'дело', 'дела', 'дел')}`;
}

function minutes(count: number): string {
  return `${count} ${plural(count, 'минуту', 'минуты', 'минут')}`;
}

function periodLine(label: string, period: StatsPeriod): string {
  return `${label}: ${deeds(period.deeds)}, ${minutes(period.minutes)}`;
}

function skillLines(summary: StatsSummary): string[] {
  if (summary.bySkill.length === 0) {
    return [];
  }
  return ['По навыкам:', ...summary.bySkill.map((entry) => `- ${entry.name}: ${deeds(entry.deeds)}, ${minutes(entry.minutes)}`)];
}

function summaryText(summary: StatsSummary): string {
  return [
    periodLine('Сегодня', summary.today),
    periodLine('За неделю', summary.week),
    periodLine('За всё время', summary.total),
    ...skillLines(summary)
  ].join('\n');
}

function summaryMarkdown(summary: StatsSummary): string {
  const lines = [
    `**Сегодня** — ${deeds(summary.today.deeds)}, ${minutes(summary.today.minutes)}`,
    `**За неделю** — ${deeds(summary.week.deeds)}, ${minutes(summary.week.minutes)}`,
    `**За всё время** — ${deeds(summary.total.deeds)}, ${minutes(summary.total.minutes)}`
  ];
  const skills = skillLines(summary);
  if (skills.length > 0) {
    lines.push('', ...skills);
  }
  return lines.join('\n');
}

function replyFor(summary: StatsSummary): Reply {
  const say =
    summary.today.deeds === 0
      ? 'Сегодня я пока ничего не делал'
      : `Сегодня я сделал ${deeds(summary.today.deeds)} и сберёг около ${minutes(summary.today.minutes)}`;
  return { say, mood: 'happy', show: { kind: 'text', title: 'Сделано', markdown: summaryMarkdown(summary) } };
}

const statsSummaryTool: ToolDef = {
  name: 'stats_summary',
  description:
    'Показывает, сколько дел Тишка сделал и сколько времени сберёг: за сегодня, за неделю и за всё время, с разбивкой по навыкам. Вызывай на вопросы «что ты сегодня сделал», «сколько времени ты мне сэкономил».',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  source: 'builtin',
  readOnly: true
};

export function registerStatsTools(registry: ToolRegistry, deps: StatsToolDeps): void {
  registry.register(statsSummaryTool, async () => {
    const summary = deps.summary();
    return { ok: true, content: summaryText(summary), data: summary, reply: replyFor(summary) };
  });
}

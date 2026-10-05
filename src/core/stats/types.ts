import type { DeedKind } from '../types';

export type { Deed, DeedKind, StatsPeriod, StatsSummary } from '../types';

// Что приходит на запись: идентификатор и время ставит хранилище.
export interface DeedInput {
  kind: DeedKind;
  title: string;
  minutes?: number;
  durationMs?: number;
  steps?: number;
  skillId?: string;
}

// Оценка «сколько минут это заняло бы руками», если она не задана явно.
export const DEFAULT_MINUTES: Record<DeedKind, number> = {
  skill: 5,
  automation: 5,
  draft: 8,
  event: 5,
  page: 3,
  reminder: 1
};

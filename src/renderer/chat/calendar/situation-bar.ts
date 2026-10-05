import type { CalendarSituation } from '../../../core/calendar/situation';

function clock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Строка обстановки вверху экрана: что идёт и когда свободен.
export function situationText(state: CalendarSituation): string {
  if (state.current !== undefined) {
    let line = `Идёт «${state.current.title}» до ${clock(state.current.end)}`;
    if (state.next !== undefined) {
      line += `, следующая «${state.next.title}» в ${clock(state.next.start)}`;
    }
    return `Сейчас: ${line}`;
  }
  if (state.workTime) {
    if (state.free && state.freeUntil !== null) {
      return `Сейчас: рабочее время, свободен до ${clock(state.freeUntil)}`;
    }
    return 'Сейчас: рабочее время';
  }
  return 'Сейчас: нерабочее время';
}

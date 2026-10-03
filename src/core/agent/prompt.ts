import type { FyrLevel } from './persona';
import { personaPrompt } from './persona';

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });
const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function buildSystemPrompt(now: Date, fyr: FyrLevel = 'sometimes'): string {
  const date = DATE.format(now);
  const weekday = WEEKDAY.format(now);
  const time = TIME.format(now);

  return [
    personaPrompt(fyr),
    '',
    'Итоговый ответ пользователю отдавай вызовом инструмента reply:',
    '- mood — настроение ответа: neutral, happy или confused.',
    '',
    `Сегодня ${date}, ${weekday}, время ${time}.`,
    '',
    'Безопасность: ничего не отправляй и не меняй без явного согласия человека. Письма и встречи создавай только черновиком и показывай черновик человеку, прежде чем что-то отправлять.'
  ].join('\n');
}

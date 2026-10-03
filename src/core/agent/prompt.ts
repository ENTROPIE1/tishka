import type { FyrLevel } from './persona';
import { personaPrompt } from './persona';

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });
const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function buildSystemPrompt(
  now: Date,
  fyr: FyrLevel = 'sometimes',
  skillGuideSection?: string
): string {
  const date = DATE.format(now);
  const weekday = WEEKDAY.format(now);
  const time = TIME.format(now);

  const sections = [
    [
      personaPrompt(fyr),
      '',
      'Любой ответ пользователю, включая уточняющий вопрос, отдавай вызовом инструмента reply — обычным текстом не отвечай:',
      '- mood — настроение ответа: neutral, happy или confused.',
      '',
      'Если просьба человека подходит под готовый навык — инструмент с именем skill__..., вызови этот навык, а не собирай то же самое из отдельных инструментов.',
      '',
      `Сегодня ${date}, ${weekday}, время ${time}.`,
      '',
      'Безопасность: ничего не отправляй и не меняй без явного согласия человека. Письма и встречи создавай только черновиком и показывай черновик человеку, прежде чем что-то отправлять.'
    ].join('\n')
  ];
  if (skillGuideSection !== undefined && skillGuideSection !== '') {
    sections.push(skillGuideSection);
  }
  return sections.join('\n\n');
}

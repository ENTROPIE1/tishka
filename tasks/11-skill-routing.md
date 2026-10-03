# 11. Выбор навыка по фразе

## Цель

Фраза пользователя запускает подходящий навык. Точное совпадение с фразой вызова срабатывает сразу, без модели. В остальных случаях навык выбирает модель: навыки видны ей как инструменты.

## Изменение контракта

В `docs/contracts.md` у `ToolDef.source` добавлено значение `'skill'`. Перенести это изменение в `src/core/types.ts`.

## Что сделать

`src/core/skills/match.ts`

```ts
function normalizePhrase(text: string): string;   // нижний регистр, ё→е, без знаков препинания, одиночные пробелы
function matchSkill(text: string, skills: Skill[]): Skill | undefined;
```

`matchSkill` возвращает навык, если нормализованный текст равен одной из его фраз либо отличается только обращением в начале («тишка», «ёжик») и словом «пожалуйста». При двух подходящих навыках выигрывает более длинная фраза. Частичное вхождение совпадением не считается.

`src/core/skills/as-tools.ts`

```ts
function syncSkillTools(registry: ToolRegistry, skills: Skill[], runner: { run(skill: Skill, inputs?: Record<string, unknown>): Promise<RunResult> }): void;
```

- Сначала `registry.unregisterSource('skill')`, затем каждый навык с триггером `manual` регистрируется как инструмент.
- Имя `skill__<id>`, `source: 'skill'`, `readOnly: false`.
- Описание: название навыка, его описание и фразы вызова в одной строке.
- `inputSchema` строится из `skill.inputs`: все поля строковые, `required` — входы с `required: true` без `default`.
- Обработчик запускает навык. Результат: `ok` из `RunResult`, `content` — `say` итоговой реплики или текст ошибки, `data` — `steps`.

`src/core/router.ts`

```ts
function createRouter(deps: {
  agent: { handle(userText: string): Promise<Reply> };
  skills: { list(): Promise<Skill[]> };
  runner: { run(skill: Skill, inputs?: Record<string, unknown>): Promise<RunResult> };
  registry: ToolRegistry;
  events: EventBus;
}): {
  handle(userText: string): Promise<Reply>;
  refreshSkills(): Promise<void>;     // перечитать навыки и вызвать syncSkillTools
};
```

1. `handle`: если `matchSkill` нашёл навык без обязательных входов без значения по умолчанию — запустить его напрямую и вернуть его реплику. При сбое навыка вернуть `Reply` с понятной фразой и `mood: 'confused'`.
2. Иначе передать текст агенту.
3. Событие `skill.saved` на шине вызывает `refreshSkills()`.
4. В системное сообщение агента (`src/core/agent/prompt.ts`) добавить правило: если просьба подходит под инструмент `skill__...`, вызвать его, а не собирать то же самое из отдельных инструментов.

## Как проверить

Тесты `tests/match.test.ts`, `tests/router.test.ts`:

- «Утро пятницы!», «тишка, утро пятницы», «Утро пятницы, пожалуйста» находят навык; «какое сегодня утро» — нет.
- Из двух навыков с фразами «утро» и «утро пятницы» на «утро пятницы» выбирается второй.
- Точное совпадение запускает навык, агент не вызывался.
- Нет совпадения → вызван агент, навык не запускался.
- `syncSkillTools`: навык `manual` появляется как `skill__<id>` с правильной схемой входов; навык с триггером `schedule` не появляется; повторный вызов не оставляет инструментов удалённых навыков.
- Вызов `skill__<id>` через реестр запускает навык с переданными входами.
- После события `skill.saved` новый навык доступен как инструмент.

## Не делать

Создание навыков, нечёткое сравнение по смыслу, окно со списком навыков.

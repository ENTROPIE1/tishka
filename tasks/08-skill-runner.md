# 08. Исполнитель навыков

## Цель

Выполнять шаги навыка по порядку. Шаги с инструментами и репликами работают без модели, поэтому готовый навык срабатывает одинаково каждый раз.

## Что сделать

`src/core/skills/template.ts`

```ts
interface TemplateContext {
  inputs: Record<string, unknown>;
  steps: Record<string, { content: string; data?: unknown }>;
  now: Date;
}
function renderTemplate(value: unknown, ctx: TemplateContext): unknown;
```

- Обходит строки, массивы и объекты рекурсивно.
- Подстановки: `{{inputs.имя}}`, `{{steps.id.content}}`, `{{steps.id.data.путь.к.полю}}` (с индексами массивов: `items.0.url`), `{{now}}` (ISO), `{{today}}` (ГГГГ-ММ-ДД).
- Если строка целиком состоит из одной подстановки, значение сохраняет свой тип (массив остаётся массивом). Иначе значение вставляется как текст.
- Неизвестная подстановка — ошибка с её названием.

`src/core/skills/runner.ts`

```ts
interface RunResult {
  ok: boolean;
  reply?: Reply;               // последняя реплика навыка
  steps: Record<string, { content: string; data?: unknown }>;
  failedStep?: string;
  error?: string;
}

function createSkillRunner(deps: {
  registry: ToolRegistry;
  ask(prompt: string): Promise<string>;     // один запрос к модели без инструментов
  events: EventBus;
  now: () => Date;
}): {
  run(skill: Skill, inputs?: Record<string, unknown>): Promise<RunResult>;
};
```

1. Входы: недостающие берутся из `default`. Нет обязательного входа без значения по умолчанию → `{ ok: false, error }` до выполнения шагов.
2. Шаг `tool`: аргументы проходят через `renderTemplate`, вызов идёт через реестр, результат сохраняется под `id` шага.
3. Шаг `ask`: текст проходит через `renderTemplate`, уходит в `deps.ask`, ответ сохраняется как `content`.
4. Шаг `say`: текст и панель проходят через `renderTemplate`, отправляется событие `reply`, реплика запоминается как итоговая.
5. Сбой шага останавливает навык: `ok: false`, `failedStep`, `error`, отправляется событие `error`. Уже выполненные шаги остаются в `steps`.
6. Если в навыке нет шага `say`, итоговая реплика — «Готово!».

## Как проверить

Тесты `tests/template.test.ts` и `tests/runner.test.ts`:

- Подстановка входа, текста шага, поля из `data`, элемента массива, `{{today}}`.
- Строка из одной подстановки сохраняет тип значения.
- Неизвестная подстановка → ошибка с её названием.
- Навык из трёх шагов (`tool` → `ask` → `say`) выполняется по порядку, результат первого шага попадает во второй.
- Сбой инструмента на втором шаге → `ok: false`, `failedStep` верный, третий шаг не выполнялся.
- Нет обязательного входа → ни один шаг не выполнялся.
- Пресет `friday-morning` вызывает `open_urls` один раз и возвращает свою реплику.

## Не делать

Триггеры, выбор навыка по фразе, создание навыков.

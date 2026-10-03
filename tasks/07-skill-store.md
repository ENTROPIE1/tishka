# 07. Хранилище навыков

## Цель

Читать, проверять, сохранять, импортировать и экспортировать навыки. Навык — файл `<id>.tishka.json` в формате из `docs/contracts.md`.

## Что сделать

`src/core/skills/validate.ts`

```ts
type ValidationResult = { ok: true; skill: Skill } | { ok: false; errors: string[] };
function validateSkill(input: unknown, knownTools?: string[]): ValidationResult;
```

Проверки, каждая ошибка — отдельная понятная строка на русском:

- `format` равен `tishka-skill/1`.
- `id` состоит из латиницы, цифр и дефиса, длина от 1 до 64.
- `name` не пустой, `phrases` — массив строк (для `manual` хотя бы одна фраза).
- `trigger` соответствует одному из трёх видов; у `schedule` задано ровно одно из `at` и `cron`; у `watch` значение `everyMinutes` не меньше 1.
- `steps` не пустой, `id` шагов уникальны, каждый шаг ровно одного вида (`tool`, `ask` или `say`).
- Подстановки `{{steps.X...}}` ссылаются только на шаги, стоящие раньше. `{{inputs.X}}` ссылаются на объявленные входы.
- Если передан `knownTools`, каждый `tool` есть в этом списке.
- В файле нет ничего похожего на секрет: строк `${secret:` и полей с именами `password`, `token`, `apiKey`, `authorization` (без учёта регистра).

`src/core/skills/store.ts`

```ts
function createSkillStore(dir: string): {
  list(): Promise<Skill[]>;
  get(id: string): Promise<Skill | undefined>;
  save(skill: Skill): Promise<void>;            // проверяет и пишет атомарно
  remove(id: string): Promise<void>;
  importFile(path: string): Promise<ValidationResult>;   // при совпадении id добавляет суффикс -2, -3
  exportFile(id: string, targetPath: string): Promise<void>;
  loadPresets(presetsDir: string): Promise<number>;      // копирует пресеты, которых ещё нет; возвращает число добавленных
};
```

- Повреждённый файл в каталоге навыков пропускается при `list()`, остальные читаются.
- `save` с невалидным навыком отклоняется со списком ошибок.

Пресет для проверки: `presets/friday-morning.tishka.json` — «Утро пятницы»: фразы «утро пятницы», «начинаем пятницу»; шаги `open_urls` с двумя примерами ссылок и `say` «Открыл всё для пятницы».

## Как проверить

Тесты `tests/skills.test.ts`:

- Пресет `friday-morning` проходит проверку.
- На каждую проверку из списка выше есть пример невалидного навыка с ожидаемой ошибкой.
- Сохранил → прочитал → получил тот же навык.
- Импорт файла с занятым `id` даёт новый `id` с суффиксом.
- Импорт файла с полем `token` отклоняется.
- Повреждённый файл не ломает `list()`.

## Не делать

Выполнение шагов, триггеры, окно галереи.

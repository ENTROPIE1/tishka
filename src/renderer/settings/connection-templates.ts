import type { ConnectionTemplate } from '../../core/connections';

export interface FieldSpec {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
}

export interface TemplateSpec {
  label: string;
  description?: string;
  fields: FieldSpec[];
  secrets: FieldSpec[];
  freeEnv: boolean;
  defaultName?: string;
}

export const TEMPLATES: Record<ConnectionTemplate, TemplateSpec> = {
  confluence: {
    label: 'Confluence',
    description: 'Тишка сможет читать страницы, их версии и историю, искать по вики',
    fields: [
      { key: 'url', label: 'Адрес', hint: 'Адрес вики без пути к странице', placeholder: 'https://wiki.example.ru' }
    ],
    secrets: [
      { key: 'token', label: 'Токен', hint: 'Личный токен доступа из профиля Confluence' }
    ],
    freeEnv: false,
    defaultName: 'confluence'
  },
  exchange: {
    label: 'Exchange',
    description: 'Тишка сможет смотреть встречи в календаре и готовить черновики писем и встреч',
    fields: [
      {
        key: 'ewsUrl',
        label: 'Адрес EWS',
        placeholder: 'https://mail.example.ru/EWS/Exchange.asmx',
        hint: 'Адрес службы почты, обычно заканчивается на /EWS/Exchange.asmx'
      },
      {
        key: 'owaUrl',
        label: 'Адрес OWA',
        placeholder: 'https://mail.example.ru/owa/',
        hint: 'Адрес веб-почты, по нему открываются черновики'
      },
      { key: 'user', label: 'Пользователь', hint: 'Логин, с которым вы входите в почту' }
    ],
    secrets: [
      {
        key: 'password',
        label: 'Пароль',
        hint: 'Хранится в зашифрованном виде, модели не передаётся'
      }
    ],
    freeEnv: false,
    defaultName: 'exchange'
  },
  'custom-stdio': {
    label: 'Свой сервер (stdio)',
    fields: [
      { key: 'command', label: 'Команда' },
      { key: 'args', label: 'Аргументы' }
    ],
    secrets: [],
    freeEnv: true
  },
  'custom-http': {
    label: 'Свой сервер (HTTP)',
    fields: [{ key: 'url', label: 'Адрес' }],
    secrets: [{ key: 'authorization', label: 'Authorization' }],
    freeEnv: false
  }
};

export const TEMPLATE_OPTIONS: Array<{ value: ConnectionTemplate; label: string }> = (
  Object.keys(TEMPLATES) as ConnectionTemplate[]
).map((value) => ({ value, label: TEMPLATES[value].label }));

export function templateLabel(template: ConnectionTemplate): string {
  return TEMPLATES[template].label;
}

export function suggestName(template: ConnectionTemplate, existingNames: string[]): string {
  const base = TEMPLATES[template].defaultName;
  if (base === undefined) {
    return '';
  }
  if (!existingNames.includes(base)) {
    return base;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingNames.includes(candidate)) {
      return candidate;
    }
  }
  return base;
}

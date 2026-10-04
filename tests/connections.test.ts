import { describe, expect, it } from 'vitest';
import {
  connectionAddress,
  describeConnection,
  planConnection,
  secretName,
  type ConnectionDraft
} from '../src/core/connections';

function draft(patch: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    template: 'confluence',
    name: 'confluence',
    fields: { url: 'https://wiki.example.org' },
    secrets: { token: 'tok-123' },
    ...patch
  };
}

describe('planConnection: confluence', () => {
  it('даёт stdio-сервер с CONFLUENCE_URL и ссылкой на секрет, значение токена только в secretsToSet', () => {
    const result = planConnection(draft(), []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.server).toEqual({
      name: 'confluence',
      transport: 'stdio',
      command: 'node',
      args: ['mcp-servers/confluence/dist/index.js'],
      env: {
        CONFLUENCE_URL: 'https://wiki.example.org',
        CONFLUENCE_TOKEN: '${secret:CONFLUENCE_TOKEN}'
      }
    });
    expect(result.plan.secretsToSet).toEqual({ CONFLUENCE_TOKEN: 'tok-123' });
    expect(JSON.stringify(result.plan.server)).not.toContain('tok-123');
  });

  it('второе подключение с именем confluence-2 получает секрет CONFLUENCE_2_TOKEN', () => {
    const result = planConnection(draft({ name: 'confluence-2' }), ['confluence']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.server).toMatchObject({
      name: 'confluence-2',
      transport: 'stdio',
      env: { CONFLUENCE_TOKEN: '${secret:CONFLUENCE_2_TOKEN}' }
    });
    expect(result.plan.secretsToSet).toEqual({ CONFLUENCE_2_TOKEN: 'tok-123' });
  });

  it('пустой секрет при правке не попадает в secretsToSet, ссылка в env остаётся', () => {
    const result = planConnection(draft({ secrets: { token: '' } }), []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.secretsToSet).toEqual({});
    expect(result.plan.server).toMatchObject({
      env: { CONFLUENCE_TOKEN: '${secret:CONFLUENCE_TOKEN}' }
    });
  });
});

describe('planConnection: exchange', () => {
  it('заполняет четыре переменные окружения, пароль — ссылкой', () => {
    const source = draft({
      template: 'exchange',
      name: 'exchange',
      fields: {
        ewsUrl: 'https://ews.example.org/EWS/Exchange.asmx',
        owaUrl: 'https://owa.example.org',
        user: 'DOM\\user'
      },
      secrets: { password: 'pass-456' }
    });
    const result = planConnection(source, []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.server).toEqual({
      name: 'exchange',
      transport: 'stdio',
      command: 'node',
      args: ['mcp-servers/exchange/dist/index.js'],
      env: {
        EXCHANGE_EWS_URL: 'https://ews.example.org/EWS/Exchange.asmx',
        EXCHANGE_OWA_URL: 'https://owa.example.org',
        EXCHANGE_USER: 'DOM\\user',
        EXCHANGE_PASSWORD: '${secret:EXCHANGE_PASSWORD}'
      }
    });
    expect(result.plan.secretsToSet).toEqual({ EXCHANGE_PASSWORD: source.secrets.password });
    expect(JSON.stringify(result.plan.server)).not.toContain(source.secrets.password);
  });
});

describe('planConnection: custom-http', () => {
  it('без секрета не добавляет заголовок, с секретом — добавляет ссылкой', () => {
    const withoutSecret = planConnection(
      draft({ template: 'custom-http', name: 'my-http', fields: { url: 'https://mcp.example.org/rpc' }, secrets: {} }),
      []
    );
    expect(withoutSecret.ok).toBe(true);
    if (!withoutSecret.ok) return;
    expect(withoutSecret.plan.server).toEqual({
      name: 'my-http',
      transport: 'http',
      url: 'https://mcp.example.org/rpc'
    });
    expect(withoutSecret.plan.secretsToSet).toEqual({});

    const withSecret = planConnection(
      draft({
        template: 'custom-http',
        name: 'my-http',
        fields: { url: 'https://mcp.example.org/rpc' },
        secrets: { authorization: 'Bearer tok-789' }
      }),
      []
    );
    expect(withSecret.ok).toBe(true);
    if (!withSecret.ok) return;
    expect(withSecret.plan.server).toEqual({
      name: 'my-http',
      transport: 'http',
      url: 'https://mcp.example.org/rpc',
      headers: { Authorization: '${secret:MY_HTTP_AUTHORIZATION}' }
    });
    expect(withSecret.plan.secretsToSet).toEqual({ MY_HTTP_AUTHORIZATION: 'Bearer tok-789' });
    expect(JSON.stringify(withSecret.plan.server)).not.toContain('Bearer tok-789');
  });
});

describe('planConnection: custom-stdio', () => {
  it('разбивает строку аргументов по пробелам, секретные переменные — ссылками', () => {
    const result = planConnection(
      draft({
        template: 'custom-stdio',
        name: 'weather',
        fields: { command: 'python', args: '  -m  weather_server --port 8080 ' },
        secrets: { API_KEY: 'key-789', EXTRA_VAR: '' }
      }),
      []
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.server).toEqual({
      name: 'weather',
      transport: 'stdio',
      command: 'python',
      args: ['-m', 'weather_server', '--port', '8080'],
      env: { API_KEY: '${secret:WEATHER_API_KEY}' }
    });
    expect(result.plan.secretsToSet).toEqual({ WEATHER_API_KEY: 'key-789' });
    expect(JSON.stringify(result.plan.server)).not.toContain('key-789');
  });
});

describe('planConnection: ошибки', () => {
  it('занятое имя даёт понятную ошибку', () => {
    const result = planConnection(draft(), ['confluence']);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('занято');
  });

  it('имя с кириллицей или пробелом даёт ошибку про латиницу', () => {
    const cyrillic = planConnection(draft({ name: 'конфлюенс' }), []);
    const spaced = planConnection(draft({ name: 'my server' }), []);

    expect(cyrillic.ok).toBe(false);
    expect(spaced.ok).toBe(false);
    if (!cyrillic.ok) {
      expect(cyrillic.errors.join(' ')).toContain('латиниц');
    }
    if (!spaced.ok) {
      expect(spaced.errors.join(' ')).toContain('латиниц');
    }
  });

  it('адрес без http даёт ошибку про http:// или https://', () => {
    const result = planConnection(draft({ fields: { url: 'wiki.example.org' } }), []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('http://');
  });

  it('правка подключения под его же именем проходит', () => {
    const result = planConnection(draft(), ['exchange', 'weather']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.server.name).toBe('confluence');
    }
  });
});

describe('planConnection: очистка значений', () => {
  it('обрезает пробелы и переводы строк у адреса и токена до проверки и сохранения', () => {
    const result = planConnection(
      draft({
        fields: { url: '  https://wiki.example.ru \n' },
        secrets: { token: '  tok-123 \n' }
      }),
      []
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.server).toMatchObject({
      env: { CONFLUENCE_URL: 'https://wiki.example.ru' }
    });
    expect(result.plan.secretsToSet).toEqual({ CONFLUENCE_TOKEN: 'tok-123' });
  });

  it('обрезает пробелы у полей и секретов своих серверов', () => {
    const result = planConnection(
      draft({
        template: 'custom-stdio',
        name: 'weather',
        fields: { command: '  python ', args: '  -m weather_server ' },
        secrets: { API_KEY: ' key-789 ' }
      }),
      []
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.server).toMatchObject({
      command: 'python',
      args: ['-m', 'weather_server']
    });
    expect(result.plan.secretsToSet).toEqual({ WEATHER_API_KEY: 'key-789' });
  });
});

describe('connectionAddress', () => {
  it('для Confluence возвращает адрес', () => {
    const planned = planConnection(draft(), []);
    if (!planned.ok) throw new Error('план должен собраться');

    expect(connectionAddress(planned.plan.server)).toBe('https://wiki.example.org');
  });

  it('для Exchange содержит адрес OWA и пользователя', () => {
    const planned = planConnection(
      draft({
        template: 'exchange',
        fields: { ewsUrl: 'https://ews.example.org', owaUrl: 'https://owa.example.org', user: 'DOM\\user' },
        secrets: { password: 'pass-456' }
      }),
      []
    );
    if (!planned.ok) throw new Error('план должен собраться');

    expect(connectionAddress(planned.plan.server)).toBe('https://owa.example.org DOM\\user');
  });

  it('для своего HTTP-сервера возвращает адрес, для stdio — команду с аргументами', () => {
    const http = planConnection(
      draft({ template: 'custom-http', name: 'my-http', fields: { url: 'https://mcp.example.org/rpc' }, secrets: {} }),
      []
    );
    const stdio = planConnection(
      draft({
        template: 'custom-stdio',
        name: 'weather',
        fields: { command: 'python', args: '-m weather_server --port 8080' },
        secrets: { API_KEY: 'key-789' }
      }),
      []
    );
    if (!http.ok || !stdio.ok) throw new Error('планы должны собраться');

    expect(connectionAddress(http.plan.server)).toBe('https://mcp.example.org/rpc');
    expect(connectionAddress(stdio.plan.server)).toBe('python -m weather_server --port 8080');
  });

  it('не содержит значений секретов', () => {
    const secret = 'sekret-password';
    const planned = planConnection(
      draft({
        template: 'exchange',
        fields: { ewsUrl: 'https://ews.example.org', owaUrl: 'https://owa.example.org', user: 'DOM\\user' },
        secrets: { password: secret }
      }),
      []
    );
    if (!planned.ok) throw new Error('план должен собраться');

    expect(connectionAddress(planned.plan.server)).not.toContain(secret);
  });
});

describe('secretName', () => {
  it('собирает имя секрета из имени сервера и поля', () => {
    expect(secretName('confluence', 'token')).toBe('CONFLUENCE_TOKEN');
    expect(secretName('confluence-2', 'token')).toBe('CONFLUENCE_2_TOKEN');
    expect(secretName('weather', 'API_KEY')).toBe('WEATHER_API_KEY');
    expect(secretName('my-http', 'authorization')).toBe('MY_HTTP_AUTHORIZATION');
  });
});

describe('describeConnection', () => {
  it('восстанавливает шаблон confluence и не возвращает значений секретов', () => {
    const planned = planConnection(draft(), []);
    if (!planned.ok) throw new Error('план должен собраться');

    const described = describeConnection(planned.plan.server);

    expect(described.template).toBe('confluence');
    expect(described.fields).toEqual({ url: 'https://wiki.example.org' });
    expect(described.secretNames).toEqual(['token']);
    expect(JSON.stringify(described)).not.toContain('tok-123');
  });

  it('восстанавливает шаблон exchange', () => {
    const source = draft({
      template: 'exchange',
      fields: { ewsUrl: 'https://ews.example.org', owaUrl: 'https://owa.example.org', user: 'DOM\\user' },
      secrets: { password: 'pass-456' }
    });
    const planned = planConnection(source, []);
    if (!planned.ok) throw new Error('план должен собраться');

    const described = describeConnection(planned.plan.server);

    expect(described.template).toBe('exchange');
    expect(described.fields).toEqual({
      ewsUrl: 'https://ews.example.org',
      owaUrl: 'https://owa.example.org',
      user: 'DOM\\user'
    });
    expect(described.secretNames).toEqual(['password']);
    expect(JSON.stringify(described)).not.toContain(source.secrets.password);
  });

  it('восстанавливает custom-stdio: команда, аргументы через пробел, имена секретных переменных', () => {
    const planned = planConnection(
      draft({
        template: 'custom-stdio',
        name: 'weather',
        fields: { command: 'python', args: '-m weather_server --port 8080' },
        secrets: { API_KEY: 'key-789' }
      }),
      []
    );
    if (!planned.ok) throw new Error('план должен собраться');

    const described = describeConnection(planned.plan.server);

    expect(described.template).toBe('custom-stdio');
    expect(described.fields).toEqual({ command: 'python', args: '-m weather_server --port 8080' });
    expect(described.secretNames).toEqual(['API_KEY']);
    expect(JSON.stringify(described)).not.toContain('key-789');
  });

  it('восстанавливает custom-http с заголовком и без него', () => {
    const planned = planConnection(
      draft({
        template: 'custom-http',
        name: 'my-http',
        fields: { url: 'https://mcp.example.org/rpc' },
        secrets: { authorization: 'Bearer tok-789' }
      }),
      []
    );
    if (!planned.ok) throw new Error('план должен собраться');
    const bare = planConnection(
      draft({ template: 'custom-http', name: 'my-http', fields: { url: 'https://mcp.example.org/rpc' }, secrets: {} }),
      []
    );
    if (!bare.ok) throw new Error('план должен собраться');

    expect(describeConnection(planned.plan.server)).toEqual({
      template: 'custom-http',
      fields: { url: 'https://mcp.example.org/rpc' },
      secretNames: ['authorization']
    });
    expect(describeConnection(bare.plan.server)).toEqual({
      template: 'custom-http',
      fields: { url: 'https://mcp.example.org/rpc' },
      secretNames: []
    });
  });
});

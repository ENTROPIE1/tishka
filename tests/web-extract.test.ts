// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractFromDocument } from '../src/core/web/extract';

const WIKI = `<!doctype html><html><head><base href="https://ru.wikipedia.org/wiki/"></head><body>
<nav>Навигация сайта</nav>
<header>Шапка</header>
<main>Чужой блок</main>
<div id="mw-content-text">
  <h1>Ёж</h1>
  <p>Ёж — небольшое <a href="Ёж_обыкновенный">млекопитающее</a> из семейства ежовых.</p>
  <script>alert('нет')</script>
  <h2>Питание</h2>
  <ul><li>насекомые</li><li>черви и слизни</li></ul>
  <table>
    <tr><th>Вид</th><th>Вес</th></tr>
    <tr><td>Ёж</td><td>один килограмм</td></tr>
  </table>
  <div class="reflist">Сноски: 1, 2</div>
  <div class="navbox">Навигационный шаблон</div>
  <aside>Боковая панель</aside>
  <div style="display: none">Скрытый текст</div>
</div>
</body></html>`;

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('extractFromDocument', () => {
  let result: ReturnType<typeof extractFromDocument>;

  beforeEach(() => {
    result = extractFromDocument(documentFrom(WIKI));
  });

  it('оставляет заголовки, абзацы, список и таблицу', () => {
    expect(result.text).toContain('# Ёж');
    expect(result.text).toContain('## Питание');
    expect(result.text).toContain('Ёж — небольшое млекопитающее из семейства ежовых.');
    expect(result.text).toContain('- насекомые');
    expect(result.text).toContain('- черви и слизни');
    expect(result.text).toContain('Вид | Вес');
    expect(result.text).toContain('Ёж | один килограмм');
  });

  it('убирает навигацию, сноски, скрипты и скрытые блоки', () => {
    expect(result.text).not.toContain('Навигация сайта');
    expect(result.text).not.toContain('Навигационный шаблон');
    expect(result.text).not.toContain('Сноски');
    expect(result.text).not.toContain('Боковая панель');
    expect(result.text).not.toContain('Скрытый текст');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('Чужой блок');
  });

  it('собирает непустые ссылки основного блока абсолютными адресами', () => {
    expect(result.links).toHaveLength(1);
    expect(result.links[0].text).toBe('млекопитающее');
    expect(result.links[0].url).toMatch(/^https:\/\/ru\.wikipedia\.org\/wiki\//);
  });

  it('разделяет абзацы пустой строкой', () => {
    expect(result.text).toContain('\n\n');
    expect(result.text).not.toMatch(/\n{3,}/);
  });

  it('обрезает текст по границе абзаца', () => {
    const doc = documentFrom(
      '<html><body><main><p>Первый абзац целиком.</p><p>Второй абзац тоже виден.</p><p>Третий абзац лишний.</p></main></body></html>'
    );
    const cut = extractFromDocument(doc, 30);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toBe('Первый абзац целиком.');
  });

  it('выбирает main, если Википедии нет', () => {
    const doc = documentFrom('<html><body><main><p>Только основной текст.</p></main></body></html>');
    expect(extractFromDocument(doc).text).toBe('Только основной текст.');
  });
});

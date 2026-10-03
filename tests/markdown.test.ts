import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/renderer/shared/markdown';

describe('renderMarkdown', () => {
  it('абзацы разделяются пустой строкой', () => {
    const html = renderMarkdown('первый абзац\n\nвторой абзац');
    expect(html).toContain('<p>первый абзац</p>');
    expect(html).toContain('<p>второй абзац</p>');
  });

  it('маркированный список превращается в ul', () => {
    const html = renderMarkdown('- один\n- два');
    expect(html).toContain('<ul><li>один</li><li>два</li></ul>');
  });

  it('нумерованный список превращается в ol', () => {
    const html = renderMarkdown('1. раз\n2. два');
    expect(html).toContain('<ol><li>раз</li><li>два</li></ol>');
  });

  it('заголовки превращаются в h1-h3', () => {
    expect(renderMarkdown('# Заголовок')).toContain('<h1>Заголовок</h1>');
    expect(renderMarkdown('### Мелкий')).toContain('<h3>Мелкий</h3>');
  });

  it('жирный текст превращается в strong', () => {
    expect(renderMarkdown('это **важно** сделать')).toContain('<strong>важно</strong>');
  });

  it('код в кавычках превращается в code', () => {
    expect(renderMarkdown('попробуй `npm test`')).toContain('<code>npm test</code>');
  });

  it('блок кода превращается в pre', () => {
    const html = renderMarkdown('до\n```\nкод <b>\n```\nпосле');
    expect(html).toContain('<pre><code>код &lt;b&gt;</code></pre>');
  });

  it('ссылка на https становится ссылкой', () => {
    const html = renderMarkdown('см. [документацию](https://example.org/doc)');
    expect(html).toContain('<a href="https://example.org/doc" data-url="https://example.org/doc">документацию</a>');
  });

  it('ссылка на http тоже становится ссылкой', () => {
    const html = renderMarkdown('[сайт](http://example.org)');
    expect(html).toContain('<a href="http://example.org"');
  });

  it('теги из исходного текста не попадают в результат', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('ссылка javascript не превращается в ссылку', () => {
    const html = renderMarkdown('[клик](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).toContain('[клик](javascript:alert(1))');
  });

  it('разметка внутри блока кода не применяется', () => {
    const html = renderMarkdown('```\n**не жирный** `и не код`\n```');
    expect(html).toContain('<pre><code>**не жирный** `и не код`</code></pre>');
  });

  it('экранирование затрагивает кавычки и амперсанд', () => {
    const html = renderMarkdown('сырье & "<готово>"');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('"');
  });
});

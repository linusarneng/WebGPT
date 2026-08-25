import { describe, expect, it } from 'vitest';
import { renderRichText } from '../src/ui/markdown';

function html(source: string): string {
  return renderRichText(source).innerHTML;
}

describe('renderRichText', () => {
  it('escapes HTML in plain paragraphs instead of injecting it', () => {
    const out = renderRichText('<img src=x onerror=alert(1)>');
    expect(out.querySelector('img')).toBeNull();
    expect(out.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('splits blank-line separated paragraphs', () => {
    const out = renderRichText('first line\n\nsecond line');
    const paragraphs = out.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0]?.textContent).toBe('first line');
    expect(paragraphs[1]?.textContent).toBe('second line');
  });

  it('keeps single newlines as line breaks within one paragraph', () => {
    const out = renderRichText('one\ntwo');
    expect(out.querySelectorAll('p').length).toBe(1);
    expect(out.querySelectorAll('br').length).toBe(1);
  });

  it('renders fenced code blocks as pre > code with escaped content', () => {
    const out = renderRichText('intro\n\n```js\nconst a = "<b>";\n```');
    const code = out.querySelector('pre > code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('const a = "<b>";\n');
    expect(code?.getAttribute('data-language')).toBe('js');
    expect(out.querySelector('b')).toBeNull();
  });

  it('renders an unterminated fence as code so streaming output stays readable', () => {
    const out = renderRichText('```\npartial output');
    expect(out.querySelector('pre > code')?.textContent).toBe('partial output');
  });

  it('renders inline code as a code element', () => {
    const out = renderRichText('run `npm test` now');
    expect(out.querySelector('code')?.textContent).toBe('npm test');
    expect(out.querySelector('pre')).toBeNull();
  });

  it('does not produce any markup for a javascript: URL', () => {
    expect(html('javascript:alert(1)')).not.toContain('<a');
  });
});

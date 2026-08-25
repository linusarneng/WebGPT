import { describe, expect, it } from 'vitest';
import { deriveTitle, DEFAULT_TITLE } from '../src/domain/chat';

describe('deriveTitle', () => {
  it('falls back for empty input', () => {
    expect(deriveTitle('')).toBe(DEFAULT_TITLE);
    expect(deriveTitle('   \n  ')).toBe(DEFAULT_TITLE);
  });

  it('collapses whitespace and keeps short prompts intact', () => {
    expect(deriveTitle('  Explain\n  quantum   tunnelling ')).toBe('Explain quantum tunnelling');
  });

  it('truncates long prompts on a word boundary with an ellipsis', () => {
    const title = deriveTitle('a'.repeat(10) + ' ' + 'b'.repeat(60));
    expect(title.length).toBeLessThanOrEqual(49);
    expect(title.endsWith('…')).toBe(true);
    expect(title.startsWith('aaaaaaaaaa')).toBe(true);
  });

  it('hard-truncates a single unbroken long word', () => {
    expect(deriveTitle('z'.repeat(120))).toBe('z'.repeat(48) + '…');
  });
});

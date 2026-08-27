import { describe, expect, it } from 'vitest';
import { splitThinking } from '../src/domain/thinking';

describe('splitThinking', () => {
  it('treats untagged text as a plain answer', () => {
    expect(splitThinking('Hello there')).toEqual({
      thinking: '',
      answer: 'Hello there',
      hasThinking: false,
      thinkingActive: false,
    });
  });

  it('separates a completed reasoning block from the final answer', () => {
    const split = splitThinking('<think>Because of scattering.</think>The sky is blue.');
    expect(split.thinking).toBe('Because of scattering.');
    expect(split.answer).toBe('The sky is blue.');
    expect(split.hasThinking).toBe(true);
    expect(split.thinkingActive).toBe(false);
  });

  it('reports an open reasoning block while only thinking has streamed', () => {
    const split = splitThinking('<think>Still working');
    expect(split.thinking).toBe('Still working');
    expect(split.answer).toBe('');
    expect(split.hasThinking).toBe(true);
    expect(split.thinkingActive).toBe(true);
  });

  it('never leaks a partial opening tag split across chunks', () => {
    for (const partial of ['<', '<t', '<thi', '<think']) {
      const split = splitThinking(`Answer so far${partial}`);
      expect(split.answer).toBe('Answer so far');
      expect(split.hasThinking).toBe(false);
    }
  });

  it('never leaks a partial closing tag split across chunks', () => {
    for (const partial of ['<', '</', '</thin', '</think']) {
      const split = splitThinking(`<think>Reasoning${partial}`);
      expect(split.thinking).toBe('Reasoning');
      expect(split.thinkingActive).toBe(true);
      expect(split.answer).toBe('');
    }
  });

  it('resolves once the closing tag completes across chunk boundaries', () => {
    expect(splitThinking('<think>Reasoning</think>Done').answer).toBe('Done');
  });

  it('keeps a less-than sign that is not a tag prefix', () => {
    expect(splitThinking('use a < b and 1 < 2').answer).toBe('use a < b and 1 < 2');
  });

  it('handles several reasoning blocks and trims surrounding whitespace', () => {
    const split = splitThinking('<think> one </think>First.<think> two </think> Second.');
    expect(split.thinking).toBe('one\n\ntwo');
    expect(split.answer).toBe('First. Second.');
  });
});

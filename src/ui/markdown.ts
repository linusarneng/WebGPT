/**
 * A deliberately tiny formatter for assistant output.
 *
 * Model text is never trusted: every node here is built with `document.createElement`
 * and `textContent`, so no path in this module can inject markup. It handles only
 * fenced code blocks, inline code, paragraphs, and hard line breaks.
 */

const FENCE = /```([A-Za-z0-9+#._-]*)[ \t]*\n?([\s\S]*?)```/g;

interface Segment {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

function splitSegments(source: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(source)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: 'text', content: source.slice(cursor, match.index) });
    }
    segments.push({ type: 'code', content: match[2] ?? '', language: match[1] || undefined });
    cursor = match.index + match[0].length;
  }

  const tail = source.slice(cursor);
  // An unclosed fence happens constantly while streaming; show it as code anyway.
  const unclosed = tail.match(/```([A-Za-z0-9+#._-]*)[ \t]*\n?([\s\S]*)$/);
  if (unclosed) {
    const before = tail.slice(0, unclosed.index ?? 0);
    if (before) segments.push({ type: 'text', content: before });
    segments.push({ type: 'code', content: unclosed[2] ?? '', language: unclosed[1] || undefined });
  } else if (tail) {
    segments.push({ type: 'text', content: tail });
  }

  return segments;
}

function appendInline(target: HTMLElement, text: string): void {
  // Alternating split: even indices are literal text, odd indices are inline code.
  const parts = text.split(/`([^`\n]+)`/g);
  parts.forEach((part, index) => {
    if (!part) return;
    if (index % 2 === 1) {
      const code = document.createElement('code');
      code.className = 'inline-code';
      code.textContent = part;
      target.append(code);
    } else {
      target.append(document.createTextNode(part));
    }
  });
}

function appendParagraphs(root: HTMLElement, text: string): void {
  for (const block of text.split(/\n{2,}/)) {
    if (!block.trim()) continue;
    const paragraph = document.createElement('p');
    block.split('\n').forEach((line, index) => {
      if (index > 0) paragraph.append(document.createElement('br'));
      appendInline(paragraph, line);
    });
    root.append(paragraph);
  }
}

function appendCodeBlock(root: HTMLElement, segment: Segment): void {
  const pre = document.createElement('pre');
  pre.className = 'code-block';
  const code = document.createElement('code');
  if (segment.language) {
    code.setAttribute('data-language', segment.language);
    pre.setAttribute('data-language', segment.language);
  }
  code.textContent = segment.content;
  pre.append(code);
  root.append(pre);
}

/** Renders untrusted text into a detached fragment container. */
export function renderRichText(source: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rich-text';
  for (const segment of splitSegments(source)) {
    if (segment.type === 'code') appendCodeBlock(root, segment);
    else appendParagraphs(root, segment.content);
  }
  return root;
}

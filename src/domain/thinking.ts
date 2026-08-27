/**
 * Model-emitted reasoning arrives inline as `<think>…</think>` inside the same
 * token stream as the answer. This splits the two apart for display. It never
 * invents, summarises or infers reasoning: whatever is returned was literally
 * emitted by the model.
 */
export interface ThinkingSplit {
  /** Text the model wrapped in `<think>` tags, tags stripped. */
  thinking: string;
  /** The final answer: everything outside the tags, safe to render as-is. */
  answer: string;
  hasThinking: boolean;
  /** True while an opening tag has arrived but its closing tag has not. */
  thinkingActive: boolean;
}

const OPEN = '<think>';
const CLOSE = '</think>';

/**
 * Drops a trailing fragment that could still grow into `tag`, so a tag split
 * across streamed chunks never flashes into the rendered output.
 */
function withoutPartialTag(text: string, tag: string): string {
  const start = text.lastIndexOf('<');
  if (start === -1) return text;
  const tail = text.slice(start);
  return tag.startsWith(tail) ? text.slice(0, start) : text;
}

/** Parses the whole accumulated reply, so chunk boundaries never matter. */
export function splitThinking(raw: string): ThinkingSplit {
  const thoughts: string[] = [];
  let answer = '';
  let rest = raw;
  let thinkingActive = false;

  for (;;) {
    const open = rest.indexOf(OPEN);
    if (open === -1) break;
    answer += rest.slice(0, open);
    const after = rest.slice(open + OPEN.length);
    const close = after.indexOf(CLOSE);
    if (close === -1) {
      thoughts.push(withoutPartialTag(after, CLOSE));
      thinkingActive = true;
      rest = '';
      break;
    }
    thoughts.push(after.slice(0, close));
    rest = after.slice(close + CLOSE.length);
  }

  if (!thinkingActive) answer += withoutPartialTag(rest, OPEN);

  const thinking = thoughts.map((part) => part.trim()).filter(Boolean).join('\n\n');
  return {
    thinking,
    answer: answer.trim(),
    hasThinking: thoughts.length > 0,
    thinkingActive,
  };
}

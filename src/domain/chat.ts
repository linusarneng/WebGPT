export type Role = 'user' | 'assistant';

/** Lifecycle of a single assistant reply. User messages are always `done`. */
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'failed';

export interface Message {
  id: string;
  role: Role;
  text: string;
  status: MessageStatus;
  /** Populated when `status === 'failed'` so the UI can explain what went wrong. */
  error?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_TITLE = 'New chat';

const MAX_TITLE_LENGTH = 48;

/** Builds a short, human-readable conversation title from the first user message. */
export function deriveTitle(firstUserMessage: string): string {
  const normalised = firstUserMessage.replace(/\s+/g, ' ').trim();
  if (!normalised) return DEFAULT_TITLE;
  if (normalised.length <= MAX_TITLE_LENGTH) return normalised;

  const clipped = normalised.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  const body = lastSpace > MAX_TITLE_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}

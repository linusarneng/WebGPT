export function now(): number {
  return Date.now();
}

/** Compact relative label used by the sidebar ("Just now", "3h ago", "12 Mar"). */
export function formatRelativeTime(timestamp: number, reference: number = now()): string {
  const seconds = Math.max(0, Math.round((reference - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

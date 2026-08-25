import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '../src/utils/time';

const MINUTE = 60_000;

describe('formatRelativeTime', () => {
  const reference = new Date('2026-03-20T12:00:00Z').getTime();

  it('labels the last minute as "Just now"', () => {
    expect(formatRelativeTime(reference - 5_000, reference)).toBe('Just now');
  });

  it('uses minutes, hours and days as the gap grows', () => {
    expect(formatRelativeTime(reference - 5 * MINUTE, reference)).toBe('5m ago');
    expect(formatRelativeTime(reference - 180 * MINUTE, reference)).toBe('3h ago');
    expect(formatRelativeTime(reference - 3 * 1440 * MINUTE, reference)).toBe('3d ago');
  });

  it('falls back to a calendar date beyond a week', () => {
    expect(formatRelativeTime(reference - 30 * 1440 * MINUTE, reference)).toMatch(/Feb/);
  });

  it('never reports a negative age for clock skew', () => {
    expect(formatRelativeTime(reference + 60_000, reference)).toBe('Just now');
  });
});

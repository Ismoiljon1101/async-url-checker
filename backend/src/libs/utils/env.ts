/**
 * Env vars arrive as strings and `Number('abc')` is NaN, which propagates
 * silently: `Array.from({ length: NaN })` is `[]`, so a mistyped concurrency
 * value would spawn zero workers and the job would report `completed` having
 * checked nothing. Every numeric setting goes through here instead, and every
 * one of them is clamped — the spec's limits are not negotiable by deployment.
 */
export function intFromEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

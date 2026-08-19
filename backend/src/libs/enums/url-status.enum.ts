/**
 * Lifecycle of a single URL check within a job. The five values, and their
 * spellings, come straight from the assignment: pending, in_progress, success,
 * error, cancelled. `cancelled` is its own state rather than a flavour of
 * `error` — a URL that was never checked did not fail, and folding the two
 * together would report a cancelled 1000-URL job as 1000 failures.
 */
export enum UrlStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Success = 'success',
  Error = 'error',
  Cancelled = 'cancelled',
}

/** URL states past which nothing changes. */
export const TERMINAL_URL_STATUSES: readonly UrlStatus[] = [
  UrlStatus.Success,
  UrlStatus.Error,
  UrlStatus.Cancelled,
];

export const isTerminalUrlStatus = (status: UrlStatus): boolean =>
  TERMINAL_URL_STATUSES.includes(status);

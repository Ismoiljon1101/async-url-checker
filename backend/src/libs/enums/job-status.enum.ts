/**
 * Lifecycle of a whole job. Enums come first in this module: every model,
 * service, and API response is built on this vocabulary, so the legal states
 * live in exactly one place.
 */
export enum JobStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

/** Job states past which nothing changes. Polling can stop here. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  JobStatus.Completed,
  JobStatus.Cancelled,
  JobStatus.Failed,
];

export const isTerminalJobStatus = (status: JobStatus): boolean =>
  TERMINAL_JOB_STATUSES.includes(status);

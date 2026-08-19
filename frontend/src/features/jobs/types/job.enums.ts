/**
 * Enums first — mirrors the backend's enums so the two apps share one
 * vocabulary. The string values match the JSON the API sends over the wire.
 */

export enum JobStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export enum UrlStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Success = 'success',
  Error = 'error',
  Cancelled = 'cancelled',
}

const TERMINAL: readonly JobStatus[] = [
  JobStatus.Completed,
  JobStatus.Cancelled,
  JobStatus.Failed,
];

/** True once a job can no longer change — the cue to stop polling it. */
export const isTerminal = (status: JobStatus): boolean =>
  TERMINAL.includes(status);

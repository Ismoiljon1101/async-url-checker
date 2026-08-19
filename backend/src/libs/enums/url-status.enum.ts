/** Lifecycle of a single URL check within a job. */
export enum UrlStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Success = 'success',
  Failed = 'failed',
}

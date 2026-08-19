import { JobStatus, UrlStatus } from '../enums';

/**
 * Domain types, built on the enums. `UrlResult` and `Job` are the internal
 * records held by the repository; `JobSummary` / `JobDetail` are the serialized
 * shapes the API returns (the internal AbortController never leaves the layer).
 */

export interface UrlResult {
  url: string;
  status: UrlStatus;
  /** HTTP status from the HEAD request; null until we have a response. */
  httpStatus: number | null;
  /** Error message when the check failed; null otherwise. */
  error: string | null;
  /** ISO timestamp when this URL entered processing; null while queued. */
  startedAt: string | null;
  /** ISO timestamp when this URL reached a terminal state; null until then. */
  finishedAt: string | null;
  /**
   * Total processing time in milliseconds: finishedAt - startedAt, so it
   * includes the artificial delay. This is the number that matches the two
   * timestamps either side of it.
   */
  durationMs: number | null;
  /**
   * Wall-clock time the HEAD request itself took, excluding the artificial
   * delay. This is the one that says anything about the URL; `durationMs`
   * mostly measures the delay.
   */
  requestMs: number | null;
}

export interface UrlStats {
  total: number;
  pending: number;
  inProgress: number;
  success: number;
  error: number;
  cancelled: number;
}

/** Internal record kept in the in-memory repository. Not serialized as-is. */
export interface Job {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  results: UrlResult[];
  /**
   * Running per-URL tallies, updated on each status transition. Kept in sync so
   * a summary is O(1) instead of an O(n) scan of `results` on every poll.
   */
  stats: UrlStats;
  /**
   * Monotonic revision, bumped on every change. Backs the ETag so a poll that
   * finds nothing new gets a 304 and the server skips serializing the job.
   */
  version: number;
  /** Cancels every in-flight and queued check for this job. */
  abort: AbortController;
}

/** GET /api/jobs — list view, no per-URL detail. */
export interface JobSummary {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  stats: UrlStats;
}

/** GET /api/jobs/:id — detail view, includes every URL result. */
export interface JobDetail extends JobSummary {
  results: UrlResult[];
}

/**
 * POST /api/jobs — the assignment specifies the response as `{ "jobId": "..." }`,
 * so `jobId` is the field the contract names. The summary is carried alongside
 * it (same `id`, plus status and stats) so the client can render the new job
 * without a second round trip.
 */
export interface JobCreated extends JobSummary {
  jobId: string;
}

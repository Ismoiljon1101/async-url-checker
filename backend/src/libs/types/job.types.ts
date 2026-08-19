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
  /** Wall-clock time the HEAD request took, in milliseconds. */
  durationMs: number | null;
}

export interface UrlStats {
  total: number;
  pending: number;
  inProgress: number;
  success: number;
  failed: number;
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

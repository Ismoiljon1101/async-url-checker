import type { JobStatus, UrlStatus } from './job.enums';

/** Types second — the shapes the API returns, built on the enums above. */

export interface UrlResult {
  url: string;
  status: UrlStatus;
  httpStatus: number | null;
  error: string | null;
  /** When this URL entered processing, and when it left it. */
  startedAt: string | null;
  finishedAt: string | null;
  /** finishedAt - startedAt, so it includes the artificial delay. */
  durationMs: number | null;
  /** The HEAD request on its own — the number that says something about the URL. */
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

/** POST /api/jobs answers with `jobId` alongside the summary. */
export interface JobCreated extends JobSummary {
  jobId: string;
}

export interface JobSummary {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  stats: UrlStats;
}

export interface JobDetail extends JobSummary {
  results: UrlResult[];
}

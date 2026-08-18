import type { JobStatus, UrlStatus } from './job.enums';

/** Types second — the shapes the API returns, built on the enums above. */

export interface UrlResult {
  url: string;
  status: UrlStatus;
  httpStatus: number | null;
  error: string | null;
  durationMs: number | null;
}

export interface UrlStats {
  total: number;
  pending: number;
  inProgress: number;
  success: number;
  failed: number;
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

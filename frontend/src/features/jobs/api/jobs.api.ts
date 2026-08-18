import { http } from '@/shared/api/http';
import type { JobDetail, JobSummary } from '@/features/jobs/types';

const BASE = '/api/jobs';

/** Typed client for the jobs endpoints. One method per route. */
export const jobsApi = {
  create(urls: string[]): Promise<JobSummary> {
    return http.post<JobSummary>(BASE, { urls });
  },

  list(): Promise<JobSummary[]> {
    return http.get<JobSummary[]>(BASE);
  },

  getById(id: string): Promise<JobDetail> {
    return http.get<JobDetail>(`${BASE}/${id}`);
  },

  cancel(id: string): Promise<JobSummary> {
    return http.delete<JobSummary>(`${BASE}/${id}`);
  },
};

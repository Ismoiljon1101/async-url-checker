import { http } from '@/shared/api/http';
import type { JobDetail, JobSummary } from '@/features/jobs/types';

const BASE = '/api/jobs';

/**
 * Typed client for the jobs endpoints. Reads go through the conditional-GET
 * wrapper, so an unchanged poll costs a 304 with no payload and still resolves
 * to the same data (and the same object reference).
 */
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

import { JobStatus, UrlStatus } from '@/features/jobs/types';

const LABELS: Record<JobStatus | UrlStatus, string> = {
  [JobStatus.Pending]: 'Pending',
  [JobStatus.InProgress]: 'In progress',
  [JobStatus.Completed]: 'Completed',
  [JobStatus.Cancelled]: 'Cancelled',
  [JobStatus.Failed]: 'Failed',
  [UrlStatus.Success]: 'OK',
};

export function StatusBadge({ status }: { status: JobStatus | UrlStatus }) {
  return <span className={`badge badge--${status}`}>{LABELS[status]}</span>;
}

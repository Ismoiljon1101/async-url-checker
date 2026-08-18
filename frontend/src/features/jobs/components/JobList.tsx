import { useJobsStore } from '@/features/jobs/store/jobs.store';
import type { JobSummary } from '@/features/jobs/types';
import { StatusBadge } from '@/shared/ui/StatusBadge';

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function JobRow({ job, active }: { job: JobSummary; active: boolean }) {
  const select = useJobsStore((s) => s.select);
  const { stats } = job;
  const checked = stats.success + stats.failed;
  return (
    <button
      className={`joblist__row ${active ? 'joblist__row--active' : ''}`}
      onClick={() => select(job.id)}
    >
      <div className="joblist__top">
        <StatusBadge status={job.status} />
        <span className="muted">{relativeTime(job.createdAt)}</span>
      </div>
      <div className="joblist__meta">
        <code className="joblist__id">{job.id.slice(0, 8)}</code>
        <span className="muted">
          {checked}/{stats.total} checked · {stats.success} ok · {stats.failed} failed
        </span>
      </div>
    </button>
  );
}

export function JobList() {
  const jobs = useJobsStore((s) => s.jobs);
  const selectedId = useJobsStore((s) => s.selectedId);

  if (!jobs.length) {
    return <p className="muted empty">No jobs yet. Start one above.</p>;
  }

  return (
    <div className="joblist">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} active={job.id === selectedId} />
      ))}
    </div>
  );
}

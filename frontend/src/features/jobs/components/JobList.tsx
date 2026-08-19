import { useJobsStore } from '@/features/jobs/store/jobs.store';
import type { JobSummary } from '@/features/jobs/types';
import { useI18n } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';
import { StatusBadge } from '@/shared/ui/StatusBadge';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

function relativeTime(iso: string, t: Translate): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return t('time.seconds', { n: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('time.minutes', { n: minutes });
  return t('time.hours', { n: Math.round(minutes / 60) });
}

function statsLine(job: JobSummary, t: Translate): string {
  const { stats } = job;
  return t('stats.line', {
    checked: stats.success + stats.failed,
    total: stats.total,
    ok: stats.success,
    failed: stats.failed,
  });
}

function JobRow({ job, active }: { job: JobSummary; active: boolean }) {
  const { t } = useI18n();
  const select = useJobsStore((s) => s.select);
  return (
    <button
      className={`joblist__row ${active ? 'joblist__row--active' : ''}`}
      onClick={() => select(job.id)}
    >
      <div className="joblist__top">
        <StatusBadge status={job.status} />
        <span className="muted">{relativeTime(job.createdAt, t)}</span>
      </div>
      <div className="joblist__meta">
        <code className="joblist__id">{job.id.slice(0, 8)}</code>
        <span className="muted">{statsLine(job, t)}</span>
      </div>
    </button>
  );
}

export function JobList() {
  const { t } = useI18n();
  const jobs = useJobsStore((s) => s.jobs);
  const selectedId = useJobsStore((s) => s.selectedId);

  if (!jobs.length) {
    return <p className="muted empty">{t('list.empty')}</p>;
  }

  return (
    <div className="joblist">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} active={job.id === selectedId} />
      ))}
    </div>
  );
}

import { useJobsStore } from '@/features/jobs/store/jobs.store';
import { isTerminal, type UrlResult } from '@/features/jobs/types';
import { useI18n } from '@/shared/i18n/i18n';
import { StatusBadge } from '@/shared/ui/StatusBadge';

function ResultRow({ result }: { result: UrlResult }) {
  return (
    <tr>
      <td className="cell-url" title={result.url}>
        {result.url}
      </td>
      <td>
        <StatusBadge status={result.status} />
      </td>
      <td className="cell-num">{result.httpStatus ?? '—'}</td>
      <td className="cell-num">
        {result.durationMs !== null ? `${result.durationMs}ms` : '—'}
      </td>
      <td className="cell-error muted">{result.error ?? ''}</td>
    </tr>
  );
}

export function JobDetail() {
  const { t } = useI18n();
  const job = useJobsStore((s) => s.selectedJob);
  const selectedId = useJobsStore((s) => s.selectedId);
  const cancel = useJobsStore((s) => s.cancelSelected);

  if (!selectedId) {
    return <p className="muted empty">{t('detail.selectPrompt')}</p>;
  }
  if (!job) {
    return <p className="muted empty">{t('detail.loading')}</p>;
  }

  const { stats } = job;
  const checked = stats.success + stats.failed;
  const pct = stats.total ? Math.round((checked / stats.total) * 100) : 0;
  const active = !isTerminal(job.status);

  return (
    <section className="detail">
      <header className="detail__head">
        <div>
          <div className="detail__title">
            <StatusBadge status={job.status} />
            <code className="muted">{job.id}</code>
          </div>
          <p className="muted detail__sub">
            {t('stats.line', {
              checked,
              total: stats.total,
              ok: stats.success,
              failed: stats.failed,
            })}
          </p>
        </div>
        {active && (
          <button className="btn btn--danger" onClick={() => void cancel()}>
            {t('detail.cancel')}
          </button>
        )}
      </header>

      <div className="progress" aria-label={`${pct}% complete`}>
        <div className="progress__bar" style={{ width: `${pct}%` }} />
      </div>

      <table className="results">
        <thead>
          <tr>
            <th>{t('table.url')}</th>
            <th>{t('table.status')}</th>
            <th className="cell-num">{t('table.http')}</th>
            <th className="cell-num">{t('table.time')}</th>
            <th>{t('table.error')}</th>
          </tr>
        </thead>
        <tbody>
          {job.results.map((result, i) => (
            <ResultRow key={`${result.url}-${i}`} result={result} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

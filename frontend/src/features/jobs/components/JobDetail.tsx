import { useJobsStore } from '@/features/jobs/store/jobs.store';
import { isTerminal, type UrlResult } from '@/features/jobs/types';
import { useI18n } from '@/shared/i18n/i18n';
import { StatusBadge } from '@/shared/ui/StatusBadge';

/** The full processing window, shown on hover; the cell itself shows the request. */
function timingTitle(result: UrlResult): string | undefined {
  if (!result.startedAt) return undefined;
  const total = result.durationMs != null ? ` (${result.durationMs}ms total)` : '';
  return `${result.startedAt} → ${result.finishedAt ?? '…'}${total}`;
}

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
      <td className="cell-num" title={timingTitle(result)}>
        {/* `!= null` on purpose: it catches undefined too, so a field the
            server has not sent renders as a dash, never "undefinedms". */}
        {result.requestMs != null ? `${result.requestMs}ms` : '—'}
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
  // "X of Y processed" counts URLs that actually got a verdict. A cancelled
  // URL was never checked, so it is reported separately rather than folded in.
  const checked = stats.success + stats.error;
  // floor, not round: 199/200 must not display as a finished 100%.
  const pct = stats.total
    ? Math.min(100, Math.floor((checked / stats.total) * 100))
    : 0;
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
              failed: stats.error,
            })}
          </p>
        </div>
        {active && (
          <button className="btn btn--danger" onClick={() => void cancel()}>
            {t('detail.cancel')}
          </button>
        )}
      </header>

      <div
        className="progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('detail.progress')}
      >
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

import { useJobsStore } from '@/features/jobs/store/jobs.store';
import { isTerminal, type UrlResult } from '@/features/jobs/types';
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
  const job = useJobsStore((s) => s.selectedJob);
  const selectedId = useJobsStore((s) => s.selectedId);
  const cancel = useJobsStore((s) => s.cancelSelected);

  if (!selectedId) {
    return <p className="muted empty">Select a job to see its URLs.</p>;
  }
  if (!job) {
    return <p className="muted empty">Loading…</p>;
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
            {checked}/{stats.total} checked · {stats.success} ok · {stats.failed} failed
          </p>
        </div>
        {active && (
          <button className="btn btn--danger" onClick={() => void cancel()}>
            Cancel job
          </button>
        )}
      </header>

      <div className="progress" aria-label={`${pct}% complete`}>
        <div className="progress__bar" style={{ width: `${pct}%` }} />
      </div>

      <table className="results">
        <thead>
          <tr>
            <th>URL</th>
            <th>Status</th>
            <th className="cell-num">HTTP</th>
            <th className="cell-num">Time</th>
            <th>Error</th>
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

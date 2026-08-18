import { useState, type FormEvent } from 'react';
import { useJobsStore } from '@/features/jobs/store/jobs.store';

const PLACEHOLDER = `https://example.com
https://github.com
https://your-api.internal/health`;

function parseUrls(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function JobForm() {
  const [raw, setRaw] = useState('');
  const creating = useJobsStore((s) => s.creating);
  const createJob = useJobsStore((s) => s.createJob);

  const urls = parseUrls(raw);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!urls.length || creating) return;
    await createJob(urls);
    setRaw('');
  };

  return (
    <form className="form" onSubmit={submit}>
      <label className="form__label" htmlFor="urls">
        URLs to check <span className="muted">(one per line)</span>
      </label>
      <textarea
        id="urls"
        className="form__textarea"
        rows={6}
        placeholder={PLACEHOLDER}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        spellCheck={false}
      />
      <div className="form__actions">
        <span className="muted">{urls.length} URL(s)</span>
        <button className="btn btn--primary" disabled={!urls.length || creating}>
          {creating ? 'Starting…' : 'Start check'}
        </button>
      </div>
    </form>
  );
}

import { useState, type FormEvent } from 'react';
import { useJobsStore } from '@/features/jobs/store/jobs.store';
import { useI18n } from '@/shared/i18n/i18n';

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
  const { t } = useI18n();
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
        {t('form.label')} <span className="muted">{t('form.hint')}</span>
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
        <span className="muted">{t('form.count', { n: urls.length })}</span>
        <button className="btn btn--primary" disabled={!urls.length || creating}>
          {creating ? t('form.submitting') : t('form.submit')}
        </button>
      </div>
    </form>
  );
}

import { useEffect } from 'react';
import { JobDetail } from '@/features/jobs/components/JobDetail';
import { JobForm } from '@/features/jobs/components/JobForm';
import { JobList } from '@/features/jobs/components/JobList';
import { startPolling, useJobsStore } from '@/features/jobs/store/jobs.store';
import { useI18n } from '@/shared/i18n/i18n';
import { LanguageSwitcher } from '@/shared/ui/LanguageSwitcher';

export default function App() {
  const { t } = useI18n();
  const error = useJobsStore((s) => s.error);

  useEffect(() => {
    void useJobsStore.getState().refreshList();
    return startPolling();
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__bar">
          <h1>{t('app.title')}</h1>
          <LanguageSwitcher />
        </div>
        <p className="muted">{t('app.subtitle')}</p>
      </header>

      {error && <div className="alert">{error}</div>}

      <div className="layout">
        <div className="layout__left">
          <JobForm />
          <h2 className="section-title">{t('list.recent')}</h2>
          <JobList />
        </div>
        <div className="layout__right">
          <JobDetail />
        </div>
      </div>
    </div>
  );
}

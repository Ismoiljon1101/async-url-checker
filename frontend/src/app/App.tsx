import { useEffect } from 'react';
import { JobDetail } from '@/features/jobs/components/JobDetail';
import { JobForm } from '@/features/jobs/components/JobForm';
import { JobList } from '@/features/jobs/components/JobList';
import { startPolling, useJobsStore } from '@/features/jobs/store/jobs.store';

export default function App() {
  const error = useJobsStore((s) => s.error);

  useEffect(() => {
    void useJobsStore.getState().refreshList();
    return startPolling();
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <h1>URL Checker</h1>
        <p className="muted">
          Submit a batch of URLs — the service checks each one asynchronously
          (max 5 at a time) and reports status, HTTP code, and timing.
        </p>
      </header>

      {error && <div className="alert">{error}</div>}

      <div className="layout">
        <div className="layout__left">
          <JobForm />
          <h2 className="section-title">Recent jobs</h2>
          <JobList />
        </div>
        <div className="layout__right">
          <JobDetail />
        </div>
      </div>
    </div>
  );
}

import { create } from 'zustand';
import { jobsApi } from '@/features/jobs/api/jobs.api';
import {
  isTerminal,
  type JobDetail,
  type JobSummary,
} from '@/features/jobs/types';

interface JobsState {
  jobs: JobSummary[];
  selectedId: string | null;
  selectedJob: JobDetail | null;
  creating: boolean;
  error: string | null;

  refreshList: () => Promise<void>;
  select: (id: string | null) => void;
  refreshSelected: () => Promise<void>;
  createJob: (urls: string[]) => Promise<void>;
  cancelSelected: () => Promise<void>;
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  selectedId: null,
  selectedJob: null,
  creating: false,
  error: null,

  async refreshList() {
    try {
      set({ jobs: await jobsApi.list() });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  select(id) {
    if (id === get().selectedId) return;
    // Drop the previous job's detail immediately so a stale view never lingers
    // while the newly selected job's first fetch is in flight.
    set({ selectedId: id, selectedJob: null, error: null });
    if (id) void get().refreshSelected();
  },

  async refreshSelected() {
    const id = get().selectedId;
    if (!id) return;
    try {
      const job = await jobsApi.getById(id);
      // Guard against a response that arrives after the user switched jobs.
      if (get().selectedId === id) set({ selectedJob: job });
    } catch (err) {
      if (get().selectedId === id) set({ error: (err as Error).message });
    }
  },

  async createJob(urls) {
    set({ creating: true, error: null });
    try {
      const summary = await jobsApi.create(urls);
      await get().refreshList();
      get().select(summary.id);
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ creating: false });
    }
  },

  async cancelSelected() {
    const id = get().selectedId;
    if (!id) return;
    try {
      await jobsApi.cancel(id);
      await Promise.all([get().refreshSelected(), get().refreshList()]);
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
}));

/**
 * Wires up polling outside React so it survives re-renders:
 *  - the job list refreshes every 2s
 *  - the open job refreshes every 1s until it reaches a terminal status
 * Returns a teardown function.
 */
export function startPolling(): () => void {
  const list = setInterval(() => void useJobsStore.getState().refreshList(), 2000);

  const detail = setInterval(() => {
    const { selectedJob, refreshSelected } = useJobsStore.getState();
    if (selectedJob && isTerminal(selectedJob.status)) return; // stop at final
    void refreshSelected();
  }, 1000);

  return () => {
    clearInterval(list);
    clearInterval(detail);
  };
}

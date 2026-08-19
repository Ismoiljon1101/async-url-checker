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
  createJob: (urls: string[]) => Promise<boolean>;
  cancelSelected: () => Promise<void>;
}

/**
 * Monotonic ticket for detail reads. Polling never awaits the previous request,
 * and a cancel fires one on top, so two reads for the same job can be in flight
 * at once. Applying only the newest ticket keeps a slow earlier response from
 * overwriting a newer snapshot (the progress bar jumping backwards).
 */
let detailTicket = 0;

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  selectedId: null,
  selectedJob: null,
  creating: false,
  error: null,

  async refreshList() {
    try {
      const jobs = await jobsApi.list();
      // An unchanged poll returns the identical array reference (304), so this
      // set is a no-op for subscribers and costs nothing.
      set({ jobs, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  select(id) {
    if (id === get().selectedId) return;
    // Drop the previous job's detail immediately so a stale view never lingers
    // while the newly selected job's first read is in flight.
    set({ selectedId: id, selectedJob: null, error: null });
    if (id) void get().refreshSelected();
  },

  async refreshSelected() {
    const id = get().selectedId;
    if (!id) return;
    const ticket = ++detailTicket;
    try {
      const job = await jobsApi.getById(id);
      // Ignore a response that lost the race: the user switched jobs, or a
      // newer read for this same job already landed.
      if (get().selectedId !== id || ticket !== detailTicket) return;
      set({ selectedJob: job, error: null });
    } catch (err) {
      if (get().selectedId === id) set({ error: (err as Error).message });
    }
  },

  /** Resolves true when the job was created. False leaves the form untouched. */
  async createJob(urls) {
    set({ creating: true, error: null });
    try {
      const summary = await jobsApi.create(urls);
      await get().refreshList();
      get().select(summary.id);
      return true;
    } catch (err) {
      set({ error: (err as Error).message });
      return false;
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
    const { selectedId, selectedJob, refreshSelected } = useJobsStore.getState();
    if (!selectedId) return; // nothing open
    if (selectedJob && isTerminal(selectedJob.status)) return; // stop at final
    void refreshSelected();
  }, 1000);

  return () => {
    clearInterval(list);
    clearInterval(detail);
  };
}

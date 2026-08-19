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
  /** Transient connectivity/detail error, shown as a global alert. */
  error: string | null;
  /** Create/validation error, owned by the form so a poll can't wipe it. */
  formError: string | null;

  refreshList: () => Promise<void>;
  select: (id: string | null) => void;
  refreshSelected: () => Promise<void>;
  createJob: (urls: string[]) => Promise<boolean>;
  cancelSelected: () => Promise<void>;
  clearFormError: () => void;
}

/**
 * Monotonic ticket for detail reads: polling never awaits the previous request
 * and a cancel fires one on top, so two reads for one job can be in flight.
 * Applying only the newest ticket stops a slow earlier response from
 * overwriting a newer snapshot.
 */
let detailTicket = 0;
/**
 * Consecutive detail-read failures. After a few (e.g. the job was evicted → 404,
 * or the server is down), the poller backs off instead of hammering a failing
 * endpoint every second forever.
 */
let detailStrikes = 0;
const MAX_DETAIL_STRIKES = 3;

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  selectedId: null,
  selectedJob: null,
  creating: false,
  error: null,
  formError: null,

  async refreshList() {
    try {
      const jobs = await jobsApi.list();
      // An unchanged poll returns the identical array reference (304), so this
      // set is a no-op for subscribers. Clearing `error` here is safe: it only
      // owns connectivity errors, never the form error.
      set({ jobs, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  select(id) {
    if (id === get().selectedId) return;
    detailStrikes = 0;
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
      detailStrikes = 0;
      set({ selectedJob: job, error: null });
    } catch (err) {
      detailStrikes += 1;
      if (get().selectedId === id) set({ error: (err as Error).message });
    }
  },

  /** Resolves true when the job was created. False leaves the form untouched. */
  async createJob(urls) {
    set({ creating: true, formError: null });
    try {
      const summary = await jobsApi.create(urls);
      await get().refreshList();
      get().select(summary.id);
      return true;
    } catch (err) {
      set({ formError: (err as Error).message });
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

  clearFormError() {
    if (get().formError) set({ formError: null });
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
    if (detailStrikes >= MAX_DETAIL_STRIKES) return; // stop hammering a failing job
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

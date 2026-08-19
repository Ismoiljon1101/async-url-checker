import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  JobStatus,
  UrlStatus,
  isTerminalJobStatus,
  isTerminalUrlStatus,
} from '../../libs/enums';
import {
  Job,
  JobCreated,
  JobDetail,
  JobSummary,
  UrlResult,
  UrlStats,
} from '../../libs/types';
import { normalizeUrl } from '../../libs/utils/url';
import { JobsRepository } from './jobs.repository';
import { UrlCheckerService } from './url-checker.service';

/**
 * Identifies this process. The store is in-memory, so a restart throws the data
 * away while clients keep their cached validators; without this, a fresh
 * counter climbing back through the same numbers would answer 304 for a job
 * list that no longer exists. Scoping the tag to a boot makes that impossible.
 */
const BOOT_ID = randomUUID().slice(0, 8);

/** Maps a URL status to its counter bucket in UrlStats (total is fixed). */
const STATS_KEY: Record<UrlStatus, keyof Omit<UrlStats, 'total'>> = {
  [UrlStatus.Pending]: 'pending',
  [UrlStatus.InProgress]: 'inProgress',
  [UrlStatus.Success]: 'success',
  [UrlStatus.Error]: 'error',
  [UrlStatus.Cancelled]: 'cancelled',
};

/**
 * Orchestrates the job lifecycle: create → run → terminal. State lives in the
 * repository, the checking is delegated to UrlCheckerService, and this service
 * owns the transitions and the shape returned to the API.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  /** Bumped on every job change; backs the list ETag. */
  private globalVersion = 0;

  constructor(
    private readonly repository: JobsRepository,
    private readonly checker: UrlCheckerService,
  ) {}

  create(urls: string[]): JobCreated {
    const now = new Date().toISOString();
    const results = urls.map<UrlResult>((url) => ({
      url: normalizeUrl(url),
      status: UrlStatus.Pending,
      httpStatus: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      requestMs: null,
    }));
    const job: Job = {
      id: randomUUID(),
      status: JobStatus.Pending,
      createdAt: now,
      updatedAt: now,
      abort: new AbortController(),
      results,
      version: 0,
      stats: {
        total: results.length,
        pending: results.length,
        inProgress: 0,
        success: 0,
        error: 0,
        cancelled: 0,
      },
    };
    if (!this.repository.save(job)) {
      throw new ServiceUnavailableException(
        'Too many jobs are still running; retry once some finish',
      );
    }
    this.globalVersion += 1; // the job set changed → invalidate the list ETag

    // Snapshot the summary while the job is still `pending`, then defer the run
    // to the next tick. POST returns `pending` (per spec); the client polls and
    // sees `in_progress` on the next request. The floated promise carries its
    // own catch so nothing before the try inside process() can escape as an
    // unhandled rejection.
    // The assignment names the response `{ "jobId": "..." }`; the summary rides
    // along so the client can render the job without a second round trip.
    const created: JobCreated = { jobId: job.id, ...this.toSummary(job) };
    setImmediate(() => {
      this.process(job).catch((err: unknown) => {
        this.logger.error(
          `Job ${job.id} failed to start`,
          err instanceof Error ? err.stack : String(err),
        );
        this.setJobStatus(job, JobStatus.Failed);
      });
    });

    return created;
  }

  list(): JobSummary[] {
    return this.repository.findAll().map((job) => this.toSummary(job));
  }

  detail(id: string): JobDetail {
    const job = this.getOrThrow(id);
    return { ...this.toSummary(job), results: [...job.results] };
  }

  cancel(id: string): JobSummary {
    const job = this.getOrThrow(id);
    if (!isTerminalJobStatus(job.status)) {
      job.abort.abort();
      // A URL that never got a verdict is `cancelled`, not `error` — it wasn't
      // checked and failed, it wasn't checked at all.
      for (const result of job.results) {
        this.transition(job, result, UrlStatus.Cancelled);
      }
      this.setJobStatus(job, JobStatus.Cancelled);
    }
    return this.toSummary(job);
  }

  private async process(job: Job): Promise<void> {
    // A cancel can land between create() and this deferred tick — if the job is
    // no longer pending, it was already finalized; don't restart it.
    if (job.status !== JobStatus.Pending) return;
    this.setJobStatus(job, JobStatus.InProgress);
    try {
      await this.checker.run(job.results, job.abort.signal, (result, next) =>
        this.transition(job, result, next),
      );
      // A cancel may have landed mid-run and already set the terminal status.
      // (Read through a predicate so the type checker doesn't narrow it away.)
      if (this.wasCancelled(job)) return;
      this.setJobStatus(job, this.outcome(job));
    } catch (err) {
      // Stop the surviving workers before finalizing, otherwise they keep
      // draining the queue and mutating a job the API already reported as done.
      job.abort.abort();
      this.logger.error(
        `Job ${job.id} crashed`,
        err instanceof Error ? err.stack : String(err),
      );
      this.setJobStatus(job, JobStatus.Failed);
    }
  }

  /**
   * The single point where a URL's status changes and the running tallies move
   * with it. Terminal states (success/failed) are never overwritten, which
   * keeps the counters correct when a cancel and an in-flight check race.
   */
  private transition(job: Job, result: UrlResult, next: UrlStatus): void {
    const from = result.status;
    if (from === next) return;
    if (isTerminalUrlStatus(from)) return;
    job.stats[STATS_KEY[from]] -= 1;
    job.stats[STATS_KEY[next]] += 1;
    result.status = next;
    this.stampTimestamps(result, next);
    this.touch(job);
  }

  /**
   * Records when a URL entered processing and when it left it. `durationMs`
   * spans exactly those two marks, so the three fields always agree; the HEAD
   * request's own timing lives separately in `requestMs`.
   */
  private stampTimestamps(result: UrlResult, next: UrlStatus): void {
    const now = new Date();
    if (next === UrlStatus.InProgress) {
      result.startedAt = now.toISOString();
      return;
    }
    if (!isTerminalUrlStatus(next)) return;
    result.finishedAt = now.toISOString();
    result.durationMs = result.startedAt
      ? now.getTime() - new Date(result.startedAt).getTime()
      : 0;
  }

  private getOrThrow(id: string): Job {
    const job = this.repository.findById(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  /**
   * A run that finished is `completed`, unless every single URL failed — then
   * nothing was actually reachable and the job itself failed. This is what
   * makes `failed` a state the API can really reach; per-URL failures on a
   * partially successful job stay on each UrlResult, not on the job.
   */
  private outcome(job: Job): JobStatus {
    const { total, error } = job.stats;
    return total > 0 && error === total ? JobStatus.Failed : JobStatus.Completed;
  }

  private setJobStatus(job: Job, status: JobStatus): void {
    // Terminal is terminal. Without this, a late rejection could rewrite a
    // `cancelled` job as `failed` after the client already stopped polling.
    if (isTerminalJobStatus(job.status)) return;
    job.status = status;
    this.touch(job);
  }

  /** Bumps the job revision (and the global one) on every change. */
  private touch(job: Job): void {
    job.version += 1;
    this.globalVersion += 1;
    job.updatedAt = new Date().toISOString();
  }

  /** Weak ETag for the list — changes whenever any job changes. */
  listEtag(): string {
    return `W/"jobs-${BOOT_ID}-${this.globalVersion}"`;
  }

  /** Weak ETag for one job — changes only when that job changes. */
  detailEtag(id: string): string {
    const job = this.getOrThrow(id);
    return `W/"${BOOT_ID}-${job.id}-${job.version}"`;
  }

  private wasCancelled(job: Job): boolean {
    return job.status === JobStatus.Cancelled;
  }

  private toSummary(job: Job): JobSummary {
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      stats: { ...job.stats },
    };
  }
}

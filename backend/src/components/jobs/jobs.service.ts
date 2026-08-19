import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JobStatus, UrlStatus, isTerminalJobStatus } from '../../libs/enums';
import {
  Job,
  JobDetail,
  JobSummary,
  UrlResult,
  UrlStats,
} from '../../libs/types';
import { normalizeUrl } from '../../libs/utils/url';
import { JobsRepository } from './jobs.repository';
import { UrlCheckerService } from './url-checker.service';

/** Maps a URL status to its counter bucket in UrlStats (total is fixed). */
const STATS_KEY: Record<UrlStatus, keyof Omit<UrlStats, 'total'>> = {
  [UrlStatus.Pending]: 'pending',
  [UrlStatus.InProgress]: 'inProgress',
  [UrlStatus.Success]: 'success',
  [UrlStatus.Failed]: 'failed',
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

  create(urls: string[]): JobSummary {
    const now = new Date().toISOString();
    const results = urls.map<UrlResult>((url) => ({
      url: normalizeUrl(url),
      status: UrlStatus.Pending,
      httpStatus: null,
      error: null,
      durationMs: null,
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
        failed: 0,
      },
    };
    this.repository.save(job);
    this.globalVersion += 1; // the job set changed → invalidate the list ETag

    // Snapshot the summary while the job is still `pending`, then defer the run
    // to the next tick. POST returns `pending` (per spec); the client polls and
    // sees `in_progress` on the next request. The floated promise carries its
    // own catch so nothing before the try inside process() can escape as an
    // unhandled rejection.
    const summary = this.toSummary(job);
    setImmediate(() => {
      this.process(job).catch((err: unknown) => {
        this.logger.error(
          `Job ${job.id} failed to start`,
          err instanceof Error ? err.stack : String(err),
        );
        this.setJobStatus(job, JobStatus.Failed);
      });
    });

    return summary;
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
      for (const result of job.results) {
        if (
          result.status === UrlStatus.Pending ||
          result.status === UrlStatus.InProgress
        ) {
          result.error = 'Cancelled';
          this.transition(job, result, UrlStatus.Failed);
        }
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
      // A finished run is Completed even if some URLs failed — per-URL failures
      // live on each UrlResult, not on the job.
      this.setJobStatus(job, JobStatus.Completed);
    } catch (err) {
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
    if (from === UrlStatus.Success || from === UrlStatus.Failed) return;
    job.stats[STATS_KEY[from]] -= 1;
    job.stats[STATS_KEY[next]] += 1;
    result.status = next;
    this.touch(job);
  }

  private getOrThrow(id: string): Job {
    const job = this.repository.findById(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  private setJobStatus(job: Job, status: JobStatus): void {
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
    return `W/"jobs-${this.globalVersion}"`;
  }

  /** Weak ETag for one job — changes only when that job changes. */
  detailEtag(id: string): string {
    const job = this.getOrThrow(id);
    return `W/"${job.id}-${job.version}"`;
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

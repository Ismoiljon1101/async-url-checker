import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { JobStatus, UrlStatus } from './enums';
import { JobsRepository } from './jobs.repository';
import {
  Job,
  JobDetail,
  JobSummary,
  UrlResult,
  UrlStats,
} from './types';
import { UrlCheckerService } from './url-checker.service';

/**
 * Orchestrates the job lifecycle: create → run → terminal. State lives in the
 * repository, the actual checking is delegated to UrlCheckerService, and this
 * service owns the transitions and the shape returned to the API.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly repository: JobsRepository,
    private readonly checker: UrlCheckerService,
  ) {}

  create(urls: string[]): JobSummary {
    const now = new Date().toISOString();
    const job: Job = {
      id: uuid(),
      status: JobStatus.Pending,
      createdAt: now,
      updatedAt: now,
      abort: new AbortController(),
      results: urls.map<UrlResult>((url) => ({
        url,
        status: UrlStatus.Pending,
        httpStatus: null,
        error: null,
        durationMs: null,
      })),
    };
    this.repository.save(job);

    // Snapshot the summary while the job is still `pending`, then defer the run
    // to the next tick. POST returns `pending` (per spec); the client polls and
    // sees `in_progress` on the next request.
    const summary = this.toSummary(job);
    setImmediate(() => void this.process(job));

    return summary;
  }

  list(): JobSummary[] {
    return this.repository.findAll().map((job) => this.toSummary(job));
  }

  detail(id: string): JobDetail {
    const job = this.getOrThrow(id);
    return { ...this.toSummary(job), results: job.results };
  }

  cancel(id: string): JobSummary {
    const job = this.getOrThrow(id);
    if (
      job.status === JobStatus.Pending ||
      job.status === JobStatus.InProgress
    ) {
      job.abort.abort();
      for (const result of job.results) {
        if (
          result.status === UrlStatus.Pending ||
          result.status === UrlStatus.InProgress
        ) {
          result.status = UrlStatus.Failed;
          result.error = 'Cancelled';
        }
      }
      this.setStatus(job, JobStatus.Cancelled);
    }
    return this.toSummary(job);
  }

  private async process(job: Job): Promise<void> {
    // A cancel can land between create() and this deferred tick — if the job is
    // no longer pending, it was already finalized; don't restart it.
    if (job.status !== JobStatus.Pending) return;
    this.setStatus(job, JobStatus.InProgress);
    try {
      await this.checker.run(job.results, job.abort.signal, () => {
        job.updatedAt = new Date().toISOString();
      });
      // A cancel may have landed mid-run and already set the terminal status.
      // (Read through a predicate so the type checker doesn't narrow it away.)
      if (this.wasCancelled(job)) return;
      // A finished run is Completed even if some URLs failed — per-URL failures
      // live on each UrlResult, not on the job.
      this.setStatus(job, JobStatus.Completed);
    } catch (err) {
      this.logger.error(`Job ${job.id} crashed`, err as Error);
      this.setStatus(job, JobStatus.Failed);
    }
  }

  private wasCancelled(job: Job): boolean {
    return job.status === JobStatus.Cancelled;
  }

  private getOrThrow(id: string): Job {
    const job = this.repository.findById(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  private setStatus(job: Job, status: JobStatus): void {
    job.status = status;
    job.updatedAt = new Date().toISOString();
  }

  private toSummary(job: Job): JobSummary {
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      stats: this.computeStats(job.results),
    };
  }

  private computeStats(results: UrlResult[]): UrlStats {
    const stats: UrlStats = {
      total: results.length,
      pending: 0,
      inProgress: 0,
      success: 0,
      failed: 0,
    };
    for (const r of results) {
      if (r.status === UrlStatus.Pending) stats.pending++;
      else if (r.status === UrlStatus.InProgress) stats.inProgress++;
      else if (r.status === UrlStatus.Success) stats.success++;
      else if (r.status === UrlStatus.Failed) stats.failed++;
    }
    return stats;
  }
}

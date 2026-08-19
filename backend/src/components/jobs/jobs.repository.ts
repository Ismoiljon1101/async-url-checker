import { Injectable } from '@nestjs/common';
import { isTerminalJobStatus } from '../../libs/enums';
import { Job } from '../../libs/types';

/**
 * In-memory job store. This is the persistence boundary: the service talks only
 * to these methods, never to a raw Map. Swapping in Redis or Postgres later is a
 * change confined to this class, and nothing above it moves.
 *
 * The Map is used as an ordered structure (insertion order == creation order),
 * which makes both "newest first" and LRU-style eviction O(n)/O(1) with no
 * sorting. Memory is capped: once over MAX_JOBS, the oldest *terminal* job is
 * evicted, so a long-lived process doesn't grow without bound while active jobs
 * are never dropped mid-run.
 */
@Injectable()
export class JobsRepository {
  private readonly jobs = new Map<string, Job>();

  save(job: Job): void {
    this.jobs.set(job.id, job);
    this.evictIfNeeded();
  }

  findById(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * All jobs, newest first. A Map preserves insertion order and jobs are saved
   * in creation order, so reversing is O(n) with no comparisons — cheaper and
   * more deterministic than sorting on createdAt.
   */
  findAll(): Job[] {
    return [...this.jobs.values()].reverse();
  }

  size(): number {
    return this.jobs.size;
  }

  /** Cap on retained jobs; override with MAX_JOBS (read at call time). */
  private maxJobs(): number {
    return Number(process.env.MAX_JOBS ?? 500);
  }

  private evictIfNeeded(): void {
    if (this.jobs.size <= this.maxJobs()) return;
    // Oldest first; evict the first job that has finished. Active jobs stay.
    for (const [id, job] of this.jobs) {
      if (isTerminalJobStatus(job.status)) {
        this.jobs.delete(id);
        return;
      }
    }
  }
}

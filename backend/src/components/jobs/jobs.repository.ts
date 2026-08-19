import { Injectable } from '@nestjs/common';
import { isTerminalJobStatus } from '../../libs/enums';
import { Job } from '../../libs/types';
import { intFromEnv } from '../../libs/utils/env';

/**
 * In-memory job store. This is the persistence boundary: the service talks only
 * to these methods, never to a raw Map. Swapping in Redis or Postgres later is a
 * change confined to this class, and nothing above it moves.
 *
 * The Map is used as an ordered structure (insertion order == creation order),
 * which makes both "newest first" and oldest-first eviction O(n)/O(1) with no
 * sorting.
 *
 * Memory is genuinely bounded at MAX_JOBS. Admitting a new job first drains
 * finished ones, oldest first; if every retained job is still running, the new
 * job is refused rather than admitted. Refusing a create is the only option
 * that bounds memory without killing work someone is waiting on.
 */
@Injectable()
export class JobsRepository {
  private readonly jobs = new Map<string, Job>();

  /**
   * Admits a job, evicting finished ones to stay under the cap. Returns false
   * when the store is full of active jobs; the job is not stored in that case.
   */
  save(job: Job): boolean {
    if (!this.jobs.has(job.id) && !this.makeRoom()) return false;
    this.jobs.set(job.id, job);
    return true;
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
    return intFromEnv(process.env.MAX_JOBS, 500, 1, 100_000);
  }

  /**
   * Drains finished jobs, oldest first, until there is room for one more. Loops
   * rather than evicting once per save: a burst of concurrent jobs can leave
   * the store well over the cap, and a single eviction per admission would let
   * that high-water mark stand forever.
   */
  private makeRoom(): boolean {
    const max = this.maxJobs();
    while (this.jobs.size >= max) {
      const finished = this.oldestTerminalId();
      if (finished === undefined) return false;
      this.jobs.delete(finished);
    }
    return true;
  }

  private oldestTerminalId(): string | undefined {
    for (const [id, job] of this.jobs) {
      if (isTerminalJobStatus(job.status)) return id;
    }
    return undefined;
  }
}

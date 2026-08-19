import { Injectable } from '@nestjs/common';
import { Job } from '../../libs/types';

/**
 * In-memory job store. This is the persistence boundary: the service talks only
 * to these methods, never to a raw Map. Swapping in Redis or Postgres later is a
 * change confined to this class, and nothing above it moves.
 *
 * The spec requires in-memory storage, so a Map it is.
 */
@Injectable()
export class JobsRepository {
  private readonly jobs = new Map<string, Job>();

  save(job: Job): void {
    this.jobs.set(job.id, job);
  }

  findById(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * All jobs, newest first. A Map preserves insertion order and jobs are saved
   * in creation order, so reversing is O(n) with no comparisons — cheaper and
   * more deterministic than sorting on createdAt (same-millisecond ties keep a
   * stable order).
   */
  findAll(): Job[] {
    return [...this.jobs.values()].reverse();
  }
}

import { Injectable } from '@nestjs/common';
import { Job } from '../types';

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

  /** All jobs, newest first. */
  findAll(): Job[] {
    return [...this.jobs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
}

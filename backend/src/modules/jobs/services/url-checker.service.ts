import { Injectable } from '@nestjs/common';
import { runWithConcurrency } from '../../../common/utils/concurrency';
import { UrlStatus } from '../enums';
import { UrlResult } from '../types';

/**
 * Concurrency is fixed at 5 by the spec. The artificial delay and request
 * timeout are env-tunable so tests can drop the delay to 0; in normal operation
 * they keep their spec defaults.
 */
export const MAX_CONCURRENCY = 5;
export const MAX_ARTIFICIAL_DELAY_MS = Number(
  process.env.MAX_CHECK_DELAY_MS ?? 10_000,
);
export const REQUEST_TIMEOUT_MS = Number(
  process.env.CHECK_TIMEOUT_MS ?? 15_000,
);

/**
 * Runs the HEAD checks for one job. Each URL waits a random 0–10s before its
 * request to mimic the uneven latency of real endpoints, then a HEAD request
 * records the status code and timing. The whole batch is tied to one
 * AbortSignal so a cancel stops queued and in-flight work alike. Concurrency is
 * delegated to the generic `runWithConcurrency` pool.
 */
@Injectable()
export class UrlCheckerService {
  async run(
    results: UrlResult[],
    signal: AbortSignal,
    onProgress: () => void,
  ): Promise<void> {
    await runWithConcurrency(
      results,
      MAX_CONCURRENCY,
      (result) => this.checkOne(result, signal, onProgress),
      signal,
    );
  }

  private async checkOne(
    result: UrlResult,
    signal: AbortSignal,
    onProgress: () => void,
  ): Promise<void> {
    if (signal.aborted) return;

    result.status = UrlStatus.InProgress;
    onProgress();

    await this.delay(
      Math.floor(Math.random() * MAX_ARTIFICIAL_DELAY_MS),
      signal,
    );
    if (signal.aborted) return;

    const startedAt = Date.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const onCancel = () => timeout.abort();
    signal.addEventListener('abort', onCancel, { once: true });

    try {
      const response = await fetch(result.url, {
        method: 'HEAD',
        signal: timeout.signal,
        redirect: 'follow',
      });
      result.httpStatus = response.status;
      result.status = response.ok ? UrlStatus.Success : UrlStatus.Failed;
      result.error = response.ok ? null : `HTTP ${response.status}`;
    } catch (err) {
      result.status = UrlStatus.Failed;
      result.httpStatus = null;
      result.error = signal.aborted ? 'Cancelled' : this.describeError(err);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onCancel);
      result.durationMs = Date.now() - startedAt;
      onProgress();
    }
  }

  /** setTimeout that resolves early (without rejecting) if the signal aborts. */
  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private describeError(err: unknown): string {
    if (err instanceof Error) {
      if (err.name === 'AbortError') return 'Request timed out';
      return err.message;
    }
    return 'Unknown error';
  }
}

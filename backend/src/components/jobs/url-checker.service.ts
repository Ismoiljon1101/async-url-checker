import { Injectable } from '@nestjs/common';
import { runWithConcurrency } from '../../libs/utils/concurrency';
import { UrlStatus } from '../../libs/enums';
import { UrlResult } from '../../libs/types';
import { toHttpUrl } from '../../libs/utils/url';

/**
 * Concurrency is 5 by the spec. It's env-tunable (MAX_CONCURRENCY) only so the
 * value can be raised for local load-testing; the default keeps every job at
 * the required 5 concurrent checks. This is an I/O-bound wait, not CPU work, so
 * one event loop handles it — extra cores or worker threads add nothing.
 */
export const DEFAULT_CONCURRENCY = 5;

/**
 * HEAD is retried with GET on these statuses: some servers reject HEAD at the
 * HTTP level (method not allowed / forbidden to bots) but answer GET, which is
 * what a browser would do.
 */
const GET_FALLBACK_STATUSES = new Set([403, 405, 501]);

/**
 * A browser-like User-Agent and Accept header. Many servers and CDNs reject or
 * reset requests from the default runtime client (no UA), which surfaces as a
 * bare "fetch failed". Sending real headers makes the check reflect what a
 * browser would actually see.
 */
const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** Called by the checker whenever a URL's status changes. */
export type SetUrlStatus = (result: UrlResult, next: UrlStatus) => void;

/**
 * Runs the HEAD checks for one job. Each URL waits a random 0–10s before its
 * request to mimic uneven latency, then a HEAD request records status code and
 * timing. The batch is tied to one AbortSignal so a cancel stops queued and
 * in-flight work alike. Concurrency is delegated to the generic pool; status
 * changes are reported through `setStatus` so the caller owns the state.
 */
@Injectable()
export class UrlCheckerService {
  async run(
    results: UrlResult[],
    signal: AbortSignal,
    setStatus: SetUrlStatus,
  ): Promise<void> {
    await runWithConcurrency(
      results,
      this.concurrency(),
      (result) => this.checkOne(result, signal, setStatus),
      signal,
    );
  }

  // Read at call time (not import time) so tests/load runs can override via env.
  private concurrency(): number {
    return Number(process.env.MAX_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  }
  private maxDelayMs(): number {
    return Number(process.env.MAX_CHECK_DELAY_MS ?? 10_000);
  }
  private timeoutMs(): number {
    return Number(process.env.CHECK_TIMEOUT_MS ?? 15_000);
  }

  private async checkOne(
    result: UrlResult,
    signal: AbortSignal,
    setStatus: SetUrlStatus,
  ): Promise<void> {
    if (signal.aborted) return;
    setStatus(result, UrlStatus.InProgress);

    // Reject anything that isn't a real http(s) URL up front, with a clean
    // message instead of a leaked "Failed to parse URL" from fetch.
    if (!toHttpUrl(result.url)) {
      result.error = 'Invalid URL';
      setStatus(result, UrlStatus.Failed);
      return;
    }

    await this.delay(Math.floor(Math.random() * this.maxDelayMs()), signal);
    if (signal.aborted) return;

    const startedAt = Date.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs());
    const onCancel = () => timeout.abort();
    signal.addEventListener('abort', onCancel, { once: true });

    try {
      const response = await this.probe(result.url, timeout.signal);
      if (signal.aborted) return; // cancelled while awaiting; leave finalized
      result.httpStatus = response.status;
      result.error = response.ok ? null : `HTTP ${response.status}`;
      setStatus(result, response.ok ? UrlStatus.Success : UrlStatus.Failed);
    } catch (err) {
      if (signal.aborted) return; // cancel() already finalized this URL
      result.httpStatus = null;
      result.error = this.describeError(err);
      setStatus(result, UrlStatus.Failed);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onCancel);
      result.durationMs = Date.now() - startedAt;
    }
  }

  /**
   * Sends HEAD, then falls back to GET when HEAD either throws (network refusal)
   * or is rejected at the HTTP level (405/501/403). The response body is
   * discarded — only the status matters.
   */
  private async probe(url: string, signal: AbortSignal): Promise<Response> {
    try {
      const head = await this.send(url, 'HEAD', signal);
      if (head.ok || !GET_FALLBACK_STATUSES.has(head.status)) return head;
    } catch (headErr) {
      if (signal.aborted) throw headErr;
    }
    return this.send(url, 'GET', signal);
  }

  private async send(
    url: string,
    method: 'HEAD' | 'GET',
    signal: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(url, {
      method,
      signal,
      redirect: 'follow',
      headers: REQUEST_HEADERS,
    });
    void response.body?.cancel().catch(() => undefined);
    return response;
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
    if (!(err instanceof Error)) return 'Unknown error';
    if (err.name === 'AbortError') return 'Request timed out';
    // fetch wraps the real network error (DNS, refused, TLS) in `cause`; its
    // `code` (ENOTFOUND, ECONNRESET, ...) is the most useful thing to show.
    const cause = 'cause' in err ? err.cause : undefined;
    if (typeof cause === 'object' && cause !== null && 'code' in cause) {
      const code = (cause as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    if (cause instanceof Error && cause.message) return cause.message;
    return err.message;
  }
}

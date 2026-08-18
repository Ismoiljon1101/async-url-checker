import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { JobStatus, UrlStatus } from '../src/modules/jobs/enums';
import { JobsRepository } from '../src/modules/jobs/repositories/jobs.repository';
import { JobsService } from '../src/modules/jobs/services/jobs.service';
import { UrlCheckerService } from '../src/modules/jobs/services/url-checker.service';

// The service is wired with its real collaborators (repository + checker), the
// same graph the module builds. `fetch` is mocked and the delay is forced to 0
// (set in the test env) so the whole suite runs in milliseconds.
//
// Note: the runner is `tsx` (esbuild), which does not emit the decorator
// metadata Nest's DI container needs, so we construct the graph by hand rather
// than through Test.createTestingModule.

type FetchImpl = typeof globalThis.fetch;
const realFetch = globalThis.fetch;

function mockFetch(impl: FetchImpl): void {
  globalThis.fetch = impl;
}

function buildService(): JobsService {
  return new JobsService(new JobsRepository(), new UrlCheckerService());
}

/** Poll the service until the job reaches a terminal status (or we time out). */
async function waitForTerminal(
  service: JobsService,
  id: string,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = service.detail(id).status;
    if (
      status === JobStatus.Completed ||
      status === JobStatus.Cancelled ||
      status === JobStatus.Failed
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Job ${id} never reached a terminal status`);
}

describe('JobsService', () => {
  let service: JobsService;

  beforeEach(() => {
    process.env.MAX_CHECK_DELAY_MS = '0';
    service = buildService();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns pending on create, then completes with per-URL HTTP status', async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const created = service.create(['https://a.test', 'https://b.test']);
    assert.equal(created.status, JobStatus.Pending);
    assert.equal(created.stats.total, 2);

    await waitForTerminal(service, created.id);

    const job = service.detail(created.id);
    assert.equal(job.status, JobStatus.Completed);
    assert.equal(job.stats.success, 2);
    assert.equal(job.stats.failed, 0);
    for (const r of job.results) {
      assert.equal(r.status, UrlStatus.Success);
      assert.equal(r.httpStatus, 200);
      assert.ok(r.durationMs !== null && r.durationMs >= 0);
    }
  });

  it('marks a non-2xx response as failed with an HTTP error', async () => {
    mockFetch(async () => new Response(null, { status: 404 }));

    const created = service.create(['https://missing.test']);
    await waitForTerminal(service, created.id);

    const [result] = service.detail(created.id).results;
    assert.equal(result.status, UrlStatus.Failed);
    assert.equal(result.httpStatus, 404);
    assert.equal(result.error, 'HTTP 404');
  });

  it('marks a thrown request as failed with the error message', async () => {
    mockFetch(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });

    const created = service.create(['https://nope.invalid']);
    await waitForTerminal(service, created.id);

    const [result] = service.detail(created.id).results;
    assert.equal(result.status, UrlStatus.Failed);
    assert.equal(result.httpStatus, null);
    assert.match(result.error ?? '', /ENOTFOUND/);
  });

  it('never runs more than 5 checks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    mockFetch(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return new Response(null, { status: 200 });
    });

    const urls = Array.from({ length: 12 }, (_, i) => `https://u${i}.test`);
    const created = service.create(urls);
    await waitForTerminal(service, created.id);

    assert.ok(peak <= 5, `peak concurrency was ${peak}, expected <= 5`);
    assert.equal(service.detail(created.id).stats.success, 12);
  });

  it('cancels an in-flight job and finalizes remaining URLs', async () => {
    // fetch that hangs until aborted, so the job stays in progress.
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const created = service.create([
      'https://x.test',
      'https://y.test',
      'https://z.test',
    ]);

    const cancelled = service.cancel(created.id);
    assert.equal(cancelled.status, JobStatus.Cancelled);

    const job = service.detail(created.id);
    assert.equal(job.status, JobStatus.Cancelled);
    for (const r of job.results) {
      assert.equal(r.status, UrlStatus.Failed);
      assert.equal(r.error, 'Cancelled');
    }
  });

  it('lists jobs newest-first', async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const first = service.create(['https://1.test']);
    await new Promise((r) => setTimeout(r, 5));
    const second = service.create(['https://2.test']);

    const list = service.list();
    assert.equal(list[0].id, second.id);
    assert.equal(list[1].id, first.id);
  });

  it('throws NotFound for an unknown job id', () => {
    assert.throws(() => service.detail('does-not-exist'), /not found/i);
  });
});

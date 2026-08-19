import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { JobStatus, UrlStatus } from '../src/libs/enums';
import type { Job } from '../src/libs/types';
import { JobsRepository } from '../src/components/jobs/jobs.repository';
import { JobsService } from '../src/components/jobs/jobs.service';
import { UrlCheckerService } from '../src/components/jobs/url-checker.service';

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
    assert.equal(job.stats.error, 0);
    for (const r of job.results) {
      assert.equal(r.status, UrlStatus.Success);
      assert.equal(r.httpStatus, 200);
      assert.ok(r.durationMs !== null && r.durationMs >= 0);
      assert.ok(r.requestMs !== null && r.requestMs >= 0);
      assert.ok(r.startedAt !== null && r.finishedAt !== null);
    }
  });

  it('marks a non-2xx response as failed with an HTTP error', async () => {
    mockFetch(async () => new Response(null, { status: 404 }));

    const created = service.create(['https://missing.test']);
    await waitForTerminal(service, created.id);

    const [result] = service.detail(created.id).results;
    assert.equal(result.status, UrlStatus.Error);
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
    assert.equal(result.status, UrlStatus.Error);
    assert.equal(result.httpStatus, null);
    assert.match(result.error ?? '', /ENOTFOUND/);
  });

  it('normalizes a bare host to https before checking', async () => {
    let requested: string | null = null;
    mockFetch(async (input) => {
      requested = String(input);
      return new Response(null, { status: 200 });
    });

    const created = service.create(['google.com']);
    await waitForTerminal(service, created.id);

    const [result] = service.detail(created.id).results;
    assert.equal(result.url, 'https://google.com');
    assert.equal(requested, 'https://google.com');
    assert.equal(result.status, UrlStatus.Success);
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
    // fetch that hangs until aborted, so the checks are genuinely in flight.
    let inFlight = 0;
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          inFlight++;
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

    // Let the deferred process() start and the fetches go in flight BEFORE we
    // cancel — otherwise we'd only be testing the pending-cancel path.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(inFlight > 0, 'expected in-flight fetches before cancel');

    const cancelled = service.cancel(created.id);
    assert.equal(cancelled.status, JobStatus.Cancelled);

    const job = service.detail(created.id);
    assert.equal(job.status, JobStatus.Cancelled);
    for (const r of job.results) {
      assert.equal(r.status, UrlStatus.Cancelled);
    }
    assert.equal(job.stats.cancelled, 3);
    assert.equal(job.stats.error, 0);
  });

  it('rejects a non-http URL with a clean error', async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const created = service.create(['ftp://files.test', 'not a url']);
    await waitForTerminal(service, created.id);

    const results = service.detail(created.id).results;
    for (const r of results) {
      assert.equal(r.status, UrlStatus.Error);
      assert.equal(r.error, 'Invalid URL');
      assert.equal(r.httpStatus, null);
    }
  });

  it('keeps aggregate stats consistent across a mixed run', async () => {
    let n = 0;
    mockFetch(async () => new Response(null, { status: n++ % 2 === 0 ? 200 : 500 }));

    const created = service.create(['a.test', 'b.test', 'c.test', 'd.test']);
    await waitForTerminal(service, created.id);

    const s = service.detail(created.id).stats;
    assert.equal(s.total, 4);
    assert.equal(s.pending, 0);
    assert.equal(s.inProgress, 0);
    assert.equal(s.success + s.error, 4);
    // the incremental counters must always sum back to total
    assert.equal(
      s.pending + s.inProgress + s.success + s.error + s.cancelled,
      s.total,
    );
  });

  it('cancel drives every URL into the cancelled tally', () => {
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const created = service.create(['x.test', 'y.test', 'z.test']);
    const s = service.cancel(created.id).stats;
    // Not `error`: these URLs were never checked, so they did not fail.
    assert.equal(s.cancelled, 3);
    assert.equal(s.error, 0);
    assert.equal(s.pending, 0);
    assert.equal(s.inProgress, 0);
  });

  it('a URL cancelled before it starts has no timing', () => {
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    // Cancel synchronously after create(), before the deferred process() runs,
    // so every URL is still pending and never entered processing.
    const created = service.create(['https://x.test', 'https://y.test']);
    service.cancel(created.id);

    for (const r of service.detail(created.id).results) {
      assert.equal(r.status, UrlStatus.Cancelled);
      assert.equal(r.startedAt, null);
      assert.equal(r.finishedAt, null);
      assert.equal(r.durationMs, null);
    }
  });

  it('cancelling an in-flight URL does not mutate it afterwards (stable ETag)', async () => {
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const created = service.create(['https://a.test']);
    // Let process() start and the HEAD go in flight before cancelling.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 10));

    service.cancel(created.id);
    const etagAtCancel = service.detailEtag(created.id);
    const reqAtCancel = service.detail(created.id).results[0].requestMs;

    // Let the aborted fetch reject and its finally run.
    await new Promise((r) => setTimeout(r, 25));
    const etagLater = service.detailEtag(created.id);
    const reqLater = service.detail(created.id).results[0].requestMs;

    assert.equal(reqAtCancel, null);
    assert.equal(reqLater, null); // never stamped on the abort path
    assert.equal(etagLater, etagAtCancel); // body unchanged → no stale 304
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

  it('list ETag changes on add; detail ETag tracks a single job', async () => {
    mockFetch(async () => new Response(null, { status: 200 }));

    const before = service.listEtag();
    const created = service.create(['https://a.test']);
    assert.notEqual(service.listEtag(), before); // adding a job changed the list

    const early = service.detailEtag(created.id);
    await waitForTerminal(service, created.id);
    assert.notEqual(service.detailEtag(created.id), early); // changed while running
    assert.equal(service.detailEtag(created.id), service.detailEtag(created.id)); // stable
  });

  it('detailEtag throws NotFound for an unknown id', () => {
    assert.throws(() => service.detailEtag('nope'), /not found/i);
  });
});

describe('JobsRepository (bounded store)', () => {
  const makeJob = (id: string, status: JobStatus): Job => ({
    id,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    results: [],
    stats: {
      total: 0,
      pending: 0,
      inProgress: 0,
      success: 0,
      error: 0,
      cancelled: 0,
    },
    version: 0,
    abort: new AbortController(),
  });

  afterEach(() => {
    delete process.env.MAX_JOBS;
  });

  it('evicts the oldest terminal job past the cap', () => {
    process.env.MAX_JOBS = '3';
    const repo = new JobsRepository();
    for (let i = 1; i <= 5; i++) {
      repo.save(makeJob(`j${i}`, JobStatus.Completed));
    }
    assert.equal(repo.size(), 3);
    assert.ok(repo.findById('j5'), 'newest kept');
    assert.ok(!repo.findById('j1'), 'oldest evicted');
  });

  it('never evicts an active job', () => {
    process.env.MAX_JOBS = '2';
    const repo = new JobsRepository();
    repo.save(makeJob('active', JobStatus.InProgress));
    repo.save(makeJob('t1', JobStatus.Completed));
    repo.save(makeJob('t2', JobStatus.Completed)); // size 3 > 2 → evict a terminal

    assert.ok(repo.findById('active'), 'active job retained');
    assert.equal(repo.size(), 2);
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { JobStatus, UrlStatus } from '../src/libs/enums';
import type { Job } from '../src/libs/types';
import { JobsRepository } from '../src/components/jobs/jobs.repository';
import { JobsService } from '../src/components/jobs/jobs.service';
import { UrlCheckerService } from '../src/components/jobs/url-checker.service';
import { isEtagMatch } from '../src/libs/utils/etag';

// The constraints the brief states outright — HEAD, the 0-10s delay, the 5-way
// cap, and the six job statuses — plus the two ways they can be defeated in
// production: a bad env var and a store that grows forever. Kept apart from
// jobs.service.test.ts so a reviewer can see the required behaviour in one file.

// Neutralize the artificial delay for the whole file; the one test that cares
// about it sets its own value.
process.env.MAX_CHECK_DELAY_MS = '0';

type FetchImpl = typeof globalThis.fetch;
const realFetch = globalThis.fetch;

function mockFetch(impl: FetchImpl): void {
  globalThis.fetch = impl;
}

function buildService(): JobsService {
  return new JobsService(new JobsRepository(), new UrlCheckerService());
}

function makeJob(id: string, status: JobStatus): Job {
  return {
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
  };
}

async function waitForTerminal(
  service: JobsService,
  id: string,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status } = service.detail(id);
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

describe('Checking logic (HEAD, delay, 5-way cap)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.MAX_CONCURRENCY;
    process.env.MAX_CHECK_DELAY_MS = '0';
  });

  it('checks with HEAD', async () => {
    process.env.MAX_CHECK_DELAY_MS = '0';
    const methods: (string | undefined)[] = [];
    mockFetch(async (_input, init) => {
      methods.push(init?.method);
      return new Response(null, { status: 200 });
    });

    const service = buildService();
    const created = service.create(['https://a.test', 'https://b.test']);
    await waitForTerminal(service, created.id);

    assert.deepEqual(methods, ['HEAD', 'HEAD']);
  });

  it('holds the pool at 5 even when MAX_CONCURRENCY asks for more', async () => {
    process.env.MAX_CHECK_DELAY_MS = '0';
    process.env.MAX_CONCURRENCY = '50';
    let live = 0;
    let peak = 0;
    mockFetch(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 20));
      live -= 1;
      return new Response(null, { status: 200 });
    });

    const service = buildService();
    const created = service.create(
      Array.from({ length: 20 }, (_, i) => `https://c${i}.test`),
    );
    await waitForTerminal(service, created.id);

    assert.ok(peak <= 5, `peak concurrency reached ${peak}; the cap is 5`);
    assert.ok(peak > 1, 'the checks really did overlap');
  });

  it('falls back to the default pool when MAX_CONCURRENCY is garbage', async () => {
    // Number('abc') is NaN and Array.from({ length: NaN }) is [], so an
    // unguarded parse spawns zero workers and "completes" a job that checked
    // nothing. This is the regression test for that.
    process.env.MAX_CHECK_DELAY_MS = '0';
    process.env.MAX_CONCURRENCY = 'abc';
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    });

    const service = buildService();
    const created = service.create(['https://x.test', 'https://y.test']);
    await waitForTerminal(service, created.id);

    assert.equal(calls, 2, 'every URL is still checked');
    assert.equal(service.detail(created.id).stats.success, 2);
  });

  it('waits the artificial delay before each check', async () => {
    process.env.MAX_CHECK_DELAY_MS = '150';
    mockFetch(async () => new Response(null, { status: 200 }));

    const service = buildService();
    const started = Date.now();
    // 40 URLs over a 5-wide pool is 8 rounds, so the odds of every draw
    // landing near zero are negligible — the run has to take real time.
    const created = service.create(
      Array.from({ length: 40 }, (_, i) => `https://d${i}.test`),
    );
    await waitForTerminal(service, created.id);

    assert.ok(Date.now() - started > 50, 'the delay was actually awaited');
    assert.equal(service.detail(created.id).stats.success, 40);
  });
});

describe('Job statuses (all six reachable)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.MAX_CHECK_DELAY_MS = '0';
  });

  it('reports in_progress while the checks run', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockFetch(async () => {
      await gate;
      return new Response(null, { status: 200 });
    });

    const service = buildService();
    const created = service.create(['https://slow.test']);
    assert.equal(created.status, JobStatus.Pending);
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(service.detail(created.id).status, JobStatus.InProgress);
    release();
    await waitForTerminal(service, created.id);
  });

  it('fails the job when every URL fails', async () => {
    mockFetch(async () => new Response(null, { status: 500 }));

    const service = buildService();
    const created = service.create(['https://e1.test', 'https://e2.test']);
    await waitForTerminal(service, created.id);

    const job = service.detail(created.id);
    assert.equal(job.status, JobStatus.Failed);
    assert.equal(job.stats.error, 2);
  });

  it('stays completed when only some URLs fail', async () => {
    let call = 0;
    mockFetch(async () => {
      call += 1;
      return new Response(null, { status: call === 1 ? 500 : 200 });
    });

    const service = buildService();
    const created = service.create(['https://m1.test', 'https://m2.test']);
    await waitForTerminal(service, created.id);

    assert.equal(service.detail(created.id).status, JobStatus.Completed);
  });

  it('never rewrites a status once it is terminal', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockFetch(async () => {
      await gate;
      return new Response(null, { status: 500 });
    });

    const service = buildService();
    const created = service.create(['https://z1.test', 'https://z2.test']);
    await new Promise((r) => setTimeout(r, 30));
    service.cancel(created.id);
    release();
    await new Promise((r) => setTimeout(r, 60));

    // Every URL ends up failed, but the cancel got there first.
    assert.equal(service.detail(created.id).status, JobStatus.Cancelled);
  });
});

describe('Store bound and admission', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.MAX_JOBS;
  });

  it('drains the whole backlog rather than evicting one per save', () => {
    process.env.MAX_JOBS = '2';
    const repo = new JobsRepository();

    // A burst of concurrent jobs pushes the store over the cap; none of them
    // can be evicted while they are still running.
    for (let i = 1; i <= 6; i++) repo.save(makeJob(`a${i}`, JobStatus.InProgress));
    for (const job of repo.findAll()) job.status = JobStatus.Completed;

    assert.equal(repo.save(makeJob('fresh', JobStatus.Pending)), true);
    assert.equal(repo.size(), 2, 'drained to the cap, not by a single entry');
    assert.ok(repo.findById('fresh'));
  });

  it('refuses a new job when every retained job is still running', () => {
    process.env.MAX_JOBS = '1';
    const repo = new JobsRepository();

    assert.equal(repo.save(makeJob('busy', JobStatus.InProgress)), true);
    assert.equal(repo.save(makeJob('next', JobStatus.Pending)), false);
    assert.equal(repo.size(), 1);
    assert.ok(repo.findById('busy'), 'the running job is never dropped');
  });

  it('rejects creation instead of growing without bound', () => {
    process.env.MAX_JOBS = '1';
    // Hangs until aborted, so the test does not wait out the request timeout.
    mockFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );

    const service = buildService();
    service.create(['https://busy.test']);

    assert.throws(
      () => service.create(['https://denied.test']),
      /Too many jobs/,
    );
  });
});

describe('Conditional GET (RFC 9110 weak comparison)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('matches the exact tag, the strong form, a list and the wildcard', () => {
    const tag = 'W/"boot1234-3"';
    assert.equal(isEtagMatch(tag, tag), true, 'exact');
    assert.equal(isEtagMatch('"boot1234-3"', tag), true, 'strong form');
    assert.equal(isEtagMatch(`W/"other", ${tag}`, tag), true, 'list');
    assert.equal(isEtagMatch('*', tag), true, 'wildcard');
    assert.equal(isEtagMatch('W/"boot1234-2"', tag), false, 'stale revision');
    assert.equal(isEtagMatch(undefined, tag), false, 'no header');
  });

  it('carries a per-process boot id so a restart cannot collide', () => {
    // The store is in-memory: a restart drops every job while clients keep
    // their cached validators. A bare counter climbing back through the same
    // numbers would answer 304 for a list that no longer exists.
    assert.match(buildService().listEtag(), /^W\/"jobs-[0-9a-f]{8}-\d+"$/);
  });
});

describe('Assignment response contract', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('answers POST with a jobId field', () => {
    // The assignment spells the response out: { "jobId": "..." }.
    mockFetch(async () => new Response(null, { status: 200 }));
    const created = buildService().create(['https://a.test']);

    assert.equal(typeof created.jobId, 'string');
    assert.equal(created.jobId, created.id);
    assert.equal(created.status, JobStatus.Pending);
  });

  it('gives every URL a start time, an end time and a matching duration', async () => {
    mockFetch(async () => new Response(null, { status: 200 }));
    const service = buildService();
    const created = service.create(['https://t1.test', 'https://t2.test']);
    await waitForTerminal(service, created.id);

    for (const r of service.detail(created.id).results) {
      assert.ok(r.startedAt, 'startedAt');
      assert.ok(r.finishedAt, 'finishedAt');
      assert.ok(r.requestMs !== null, 'requestMs');
      const span =
        new Date(r.finishedAt as string).getTime() -
        new Date(r.startedAt as string).getTime();
      assert.equal(r.durationMs, span, 'durationMs spans the two timestamps');
    }
  });

  it('uses error, not failed, for a URL that came back bad', async () => {
    mockFetch(async () => new Response(null, { status: 503 }));
    const service = buildService();
    const created = service.create(['https://bad.test']);
    await waitForTerminal(service, created.id);

    const [result] = service.detail(created.id).results;
    assert.equal(result.status, UrlStatus.Error);
    assert.equal(result.error, 'HTTP 503');
  });

  it('marks an unstarted URL cancelled, and leaves finished ones alone', async () => {
    let settled = 0;
    // The first check answers; the rest hang until the job's signal aborts, so
    // the suite never waits out the real request timeout.
    mockFetch(async (_input, init) => {
      settled += 1;
      if (settled > 1) {
        await new Promise<void>((resolve) =>
          init?.signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
        throw new DOMException('Aborted', 'AbortError');
      }
      return new Response(null, { status: 200 });
    });

    const service = buildService();
    const created = service.create([
      'https://one.test',
      'https://two.test',
      'https://three.test',
    ]);
    await new Promise((r) => setTimeout(r, 40));
    service.cancel(created.id);

    const job = service.detail(created.id);
    const statuses = job.results.map((r) => r.status);
    assert.equal(job.status, JobStatus.Cancelled);
    assert.ok(statuses.includes(UrlStatus.Success), 'the finished check is kept');
    assert.ok(statuses.includes(UrlStatus.Cancelled), 'the rest are cancelled');
    assert.equal(job.stats.error, 0, 'nothing is booked as an error');
    assert.equal(
      job.stats.success + job.stats.cancelled,
      job.stats.total,
      'the tallies still add up',
    );
  });
});

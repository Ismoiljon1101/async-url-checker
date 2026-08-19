# URL Checker

**English** · [Русский](README.ru.md)

A small service that checks a batch of URLs asynchronously and shows you the result as it happens. You paste a list of URLs, the backend fires a HEAD request at each one, and the UI polls for progress until every URL has a verdict. Checks run five at a time, and you can cancel a job mid-flight.

Built with the stack from the brief: Node.js + TypeScript + NestJS on the back, React + TypeScript + Zustand on the front. Data lives in memory, no database.

## Run it

### Docker (both services at once)

```bash
docker compose up --build
```

- UI: http://localhost:8080
- API: http://localhost:3000

nginx serves the built frontend and proxies `/api` to the backend, so the browser talks to one origin.

### Pre-built images (no local build)

CI publishes both images to GitHub Container Registry on every push to `main`. To run them without building anything:

```bash
docker compose -f docker-compose.ghcr.yml up
```

Same URLs as above. Images live at `ghcr.io/ismoiljon1101/async-url-checker-backend` and `-frontend`.

### Local (two terminals)

```bash
# terminal 1: backend on :3000
cd backend
pnpm install
pnpm start:dev

# terminal 2: frontend on :5173 (Vite proxies /api to :3000)
cd frontend
pnpm install
pnpm dev
```

Then open http://localhost:5173.

### Tests

```bash
cd backend
pnpm test
```

32 tests cover the parts that are easy to get wrong: the HEAD method, the concurrency cap (including the case where an env var tries to raise it), the artificial delay, cancellation, HTTP-code handling, URL normalization, all five job statuses and the `error` / `cancelled` split on URLs, the store's memory bound, and conditional-GET matching. They run against the services directly with `fetch` mocked, so the whole suite finishes in a couple of seconds.

## API

Base path `/api/jobs`. Every response uses the same status vocabulary defined in `libs/enums`.

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/api/jobs` | Create a job. Body: `{ "urls": ["https://..."] }`. Answers `{ "jobId": "..." }` with status `pending`, plus the summary so the client can render it without a second call. |
| `GET` | `/api/jobs` | List jobs, newest first: `id`, `createdAt`, `status`, and rolled-up stats. |
| `GET` | `/api/jobs/:id` | One job with the per-URL breakdown. |
| `DELETE` | `/api/jobs/:id` | Cancel a job. Stops queued and in-flight checks alike. |
| `GET` | `/health` | Liveness, used by the compose healthcheck. |

Job status is one of `pending`, `in_progress`, `completed`, `cancelled`, `failed`. Each URL carries its own `pending`, `in_progress`, `success`, `error`, `cancelled`.

A URL that was cancelled is `cancelled`, never `error`. It was not checked and failed; it was not checked at all. Folding the two together would report a cancelled 1000-URL job as a thousand failures.

Each URL result carries four timing fields:

| Field | Means |
| --- | --- |
| `startedAt` | when the URL entered processing |
| `finishedAt` | when it reached a terminal state |
| `durationMs` | `finishedAt - startedAt`, so it includes the artificial delay |
| `requestMs` | the HEAD request on its own |

The two are separate on purpose. `durationMs` is mostly the artificial delay, so `requestMs` is the number that says anything about the URL, and it is the one the UI shows.

Quick check with curl:

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com","https://github.com"]}'
```

## How it's built

### Schema first

Types start from enums. `job-status.enum.ts` and `url-status.enum.ts` define the legal states, the model types build on them, and the DTO validates the one thing that comes from outside. Nothing downstream invents its own string for "completed". The frontend mirrors the same enums, so both apps speak one language over the wire.

### Layout

Backend follows NestJS's module system: feature modules under `components/`, shared code under `libs/`, and a thin root module.

```
backend/src/
  app.module.ts          root module, imports the feature modules
  main.ts                bootstrap (CORS, ValidationPipe, exception filter)
  components/
    jobs/                the jobs feature module
      jobs.controller.ts   routes only
      jobs.service.ts      lifecycle orchestration
      jobs.repository.ts   in-memory store (persistence boundary)
      url-checker.service.ts  HEAD checks, 5-way pool, cancel
      jobs.module.ts       wires it together via DI
  libs/                  shared across features
    dto/ enums/ types/   request schema, status vocabulary, domain types
    utils/               generic concurrency pool, URL normalizer
    filters/             global exception filter

frontend/src/
  features/jobs/         api, store, components, types for the jobs feature
  shared/                http client, UI (StatusBadge, language switch), i18n
  app/  styles/
```

`JobsService` owns state transitions, `JobsRepository` owns storage, `UrlCheckerService` owns the actual checking. Splitting them means the concurrency and cancellation logic is tested on its own, without HTTP in the way.

### Bilingual UI

The interface ships in English and Russian. The switch in the header persists your choice and the app also picks up the browser language on first load. Strings live in one dictionary (`shared/i18n`), keyed and typed so a missing translation is a compile error.

### Concurrency and cancellation

The checker runs a shared cursor over the URL array with five workers pulling the next index until the array drains. That caps in-flight requests at five without pulling in a queue library. Each URL waits a random 0 to 10 seconds before its request, matching the brief.

Every job owns one `AbortController`. Cancelling aborts it, which cuts the artificial delay and any in-flight `fetch` at once, and flips the remaining URLs to a final state so the numbers still add up. A request that runs long hits a 15-second timeout on its own controller.

The `POST` returns `pending` on purpose. The run is deferred to the next tick, so the client gets its job id back before any check starts, then watches it move.

### Polling, made cheap with ETags

The store runs two intervals outside React so they survive re-renders. The list refreshes every two seconds. The open job refreshes every second and stops the moment it reaches a terminal status. Switching jobs clears the old detail right away and ignores any late response from the job you just left, so a slow reply never paints over the job you are now looking at.

Each GET carries a version-based `ETag` (a per-job counter, and a global one for the list). The client sends `If-None-Match`; when nothing changed the server returns `304` with an empty body and never serializes the response. A finished job that the UI keeps polling costs a few header bytes instead of a full payload each tick. The version compare is O(1), so it beats a body-hash ETag too.

### Bounded memory

The store is a `Map` used as an ordered structure. Newest-first is a reverse, not a sort. Retained jobs are capped (`MAX_JOBS`, default 500); once over the cap the oldest *finished* job is evicted, so a long-lived process stays bounded and an active job is never dropped mid-run. Per-URL tallies are counters updated on each transition, so a summary is O(1) rather than an O(n) rescan.

### Why not multiple cores

The checking is I/O-bound — it waits on sockets, so one event loop already runs many requests at once and extra cores or worker threads add nothing. The concurrency cap (5) and the artificial delay are the spec, and they are what set the wall-clock for a large batch, not CPU. In-memory storage also rules out clustering: separate processes would hold separate maps. Both `MAX_CONCURRENCY` and `MAX_CHECK_DELAY_MS` are env-tunable for local load runs; the defaults are the spec's 5 and 0–10s.

## Notes

- In-memory by design, per the brief. Jobs reset when the backend restarts. Moving to Redis or Postgres would be a store swap behind `JobsService`, nothing above it changes.
- HEAD is the right call for a liveness check since it skips the body. A few hosts answer HEAD oddly or refuse it. When that happens the URL comes back `error` with the message, which is the honest result for a checker.
- The simulated delay is env-tunable (`MAX_CHECK_DELAY_MS`) so tests run instantly and you can watch the concurrency limit work without waiting.
- A bare host like `google.com` is normalized to `https://google.com` before the check, since `fetch` needs an absolute URL.

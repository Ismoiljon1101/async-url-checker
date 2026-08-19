# URL Checker

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

Seven tests cover the parts that are easy to get wrong: the concurrency cap, cancellation, HTTP-code handling, and the `pending → in_progress → completed` transitions. They run against the services directly with `fetch` mocked, so the whole suite finishes in about a second.

## API

Base path `/api/jobs`. Every response uses the same status vocabulary defined in `schema/job.enums.ts`.

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/api/jobs` | Create a job. Body: `{ "urls": ["https://..."] }`. Returns the job with status `pending`. |
| `GET` | `/api/jobs` | List jobs, newest first, each with rolled-up stats. |
| `GET` | `/api/jobs/:id` | One job with the per-URL breakdown (status, HTTP code, error, timing). |
| `DELETE` | `/api/jobs/:id` | Cancel a running job. |

Job status is one of `pending`, `in_progress`, `completed`, `cancelled`, `failed`. Each URL carries its own `pending` / `in_progress` / `success` / `failed`.

Quick check with curl:

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com","https://github.com"]}'
```

## How it's built

### Schema first

Each side starts from a `schema/` folder, and the schema starts from enums. `job.enums.ts` defines the legal states, `job.model.ts` builds the types on top of them, and the DTO validates the one thing that comes from outside. Nothing downstream invents its own string for "completed". The frontend mirrors the same enums so both apps speak one language over the wire.

### Layout

```
backend/src/jobs/
  controllers/   routes only, thin pass-through to services
  services/      business logic (job lifecycle + the checker)
  schema/        enums, models, DTOs
frontend/src/
  schema/        enums + models, mirroring the backend
  components/    form, list, detail view
  store.ts       Zustand store + the polling loop
  api.ts         typed fetch wrapper
```

Controllers hold no logic. `JobsService` owns state transitions and the in-memory store; `UrlCheckerService` owns the actual checking. Splitting them means the concurrency and cancellation logic is tested on its own, without HTTP in the way.

### Concurrency and cancellation

The checker runs a shared cursor over the URL array with five workers pulling the next index until the array drains. That caps in-flight requests at five without pulling in a queue library. Each URL waits a random 0 to 10 seconds before its request, matching the brief.

Every job owns one `AbortController`. Cancelling aborts it, which cuts the artificial delay and any in-flight `fetch` at once, and flips the remaining URLs to a final state so the numbers still add up. A request that runs long hits a 15-second timeout on its own controller.

The `POST` returns `pending` on purpose. The run is deferred to the next tick, so the client gets its job id back before any check starts, then watches it move.

### Polling

The store runs two intervals outside React so they survive re-renders. The list refreshes every two seconds. The open job refreshes every second and stops the moment it reaches a terminal status. Switching jobs clears the old detail right away and ignores any late response from the job you just left, so a slow reply never paints over the job you are now looking at.

## Notes

- In-memory by design, per the brief. Jobs reset when the backend restarts. Moving to Redis or Postgres would be a store swap behind `JobsService`, nothing above it changes.
- HEAD is the right call for a liveness check since it skips the body. A few hosts answer HEAD oddly or refuse it. When that happens the URL comes back failed with the error, which is the honest result for a checker.
- The simulated delay is env-tunable (`MAX_CHECK_DELAY_MS`) so tests run instantly and you can watch the concurrency limit work without waiting.

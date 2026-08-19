/**
 * Generic concurrency-limited runner. A shared cursor over `items` acts as the
 * work queue: `limit` workers pull the next index until the list drains, so no
 * more than `limit` `worker` calls are ever in flight. An optional AbortSignal
 * stops queued work between iterations.
 *
 * Reusable across the codebase; the URL checker is just its first caller.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  };

  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()));
}

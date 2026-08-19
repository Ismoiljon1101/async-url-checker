/**
 * Tiny fetch wrapper shared across features. Centralizes JSON parsing, turns a
 * non-2xx response into a thrown Error, and adds conditional GETs: it remembers
 * each URL's ETag *and the body that came with it*, sends If-None-Match, and on
 * a 304 replays the cached body. Callers never see the 304 — they always get
 * data, so the transport optimization can't leak into the UI. The saving is the
 * payload and the server-side serialization, not the round trip.
 */

interface CacheEntry<T = unknown> {
  etag: string;
  body: T;
}

interface ApiErrorBody {
  message?: string | string[];
}

/**
 * Bounded so a long session that opens hundreds of jobs can't grow the cache
 * without limit. Insertion order makes the Map an LRU: re-caching deletes the
 * key first, so the oldest entry is always the first one out.
 */
const MAX_ENTRIES = 100;
const cache = new Map<string, CacheEntry>();

function remember(url: string, entry: CacheEntry): void {
  cache.delete(url);
  cache.set(url, entry);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (body.message) {
        message = Array.isArray(body.message)
          ? body.message.join(', ')
          : body.message;
      }
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const http = {
  /**
   * Conditional GET. Returns the freshly parsed body, or the cached one when
   * the server answers 304. The returned reference is stable across 304s, which
   * is what lets a caller skip a re-render on an unchanged poll.
   */
  async get<T>(url: string): Promise<T> {
    const cached = cache.get(url) as CacheEntry<T> | undefined;
    const headers: Record<string, string> = {};
    if (cached) headers['If-None-Match'] = cached.etag;

    const res = await fetch(url, { headers });
    if (res.status === 304 && cached) return cached.body;

    const body = await parse<T>(res);
    const etag = res.headers.get('ETag');
    if (etag) remember(url, { etag, body });
    return body;
  },

  post<T>(url: string, body: unknown): Promise<T> {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((res) => parse<T>(res));
  },

  delete<T>(url: string): Promise<T> {
    return fetch(url, { method: 'DELETE' }).then((res) => parse<T>(res));
  },
};

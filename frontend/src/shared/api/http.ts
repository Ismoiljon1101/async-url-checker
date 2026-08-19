/**
 * Tiny fetch wrapper shared across features. Centralizes JSON parsing, turns a
 * non-2xx response into a thrown Error, and adds conditional GETs: it remembers
 * each URL's ETag and sends If-None-Match, so an unchanged poll comes back as a
 * 304 with no body and returns NOT_MODIFIED instead of re-parsing the same data.
 */

export const NOT_MODIFIED = Symbol('not-modified');
export type NotModified = typeof NOT_MODIFIED;

interface ApiErrorBody {
  message?: string | string[];
}

const etags = new Map<string, string>();

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
  /** Conditional GET: returns NOT_MODIFIED when the resource is unchanged. */
  async get<T>(url: string): Promise<T | NotModified> {
    const headers: Record<string, string> = {};
    const known = etags.get(url);
    if (known) headers['If-None-Match'] = known;

    const res = await fetch(url, { headers });
    if (res.status === 304) return NOT_MODIFIED;

    const etag = res.headers.get('ETag');
    if (etag) etags.set(url, etag);
    return parse<T>(res);
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

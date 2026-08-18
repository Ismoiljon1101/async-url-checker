/**
 * Tiny fetch wrapper shared across features. Centralizes JSON parsing and turns
 * a non-2xx response into a thrown Error carrying the server's message, so
 * callers only deal with resolved data or a catch.
 */

interface ApiErrorBody {
  message?: string | string[];
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
  get<T>(url: string): Promise<T> {
    return fetch(url).then((res) => parse<T>(res));
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

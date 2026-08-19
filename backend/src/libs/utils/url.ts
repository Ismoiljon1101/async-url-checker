/**
 * Normalizes user-entered URLs so a bare host like "google.com" becomes an
 * absolute URL ("https://google.com"). fetch() rejects anything without a
 * scheme. A value that already carries a scheme (http, https, ftp, ...) or is
 * protocol-relative is left alone — validation happens later in `toHttpUrl`.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  // Any other explicit scheme (ftp://, ws://, file://) — keep as-is so it fails
  // the http(s) check rather than being mangled into https://scheme://...
  if (/^[a-zA-Z][\w+.-]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Parses a normalized URL and returns it only if it is an http(s) URL; returns
 * null for empty input, unparseable strings, or non-http schemes (ftp:, ws:,
 * javascript:). Callers use null to fail the check with a clean "Invalid URL".
 */
export function toHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}

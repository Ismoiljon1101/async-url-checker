/**
 * If-None-Match evaluation, per RFC 9110 §13.1.2: GET and HEAD use the *weak*
 * comparison function, so `W/"x"` and `"x"` match each other, the header may
 * carry a comma-separated list, and `*` matches any existing representation.
 *
 * A plain `===` against our own tag happens to work for our own frontend, which
 * echoes back exactly what it was sent. It quietly fails for every other
 * client — a proxy that strips `W/`, or a browser that merges validators into a
 * list — and those clients then pay for a full serialization they didn't need.
 *
 * Tags here are generated from a boot id, a UUID and a counter, so none of them
 * contains a comma and splitting on one is safe.
 */
const opaqueTag = (tag: string): string => tag.trim().replace(/^W\//, '');

export function isEtagMatch(
  ifNoneMatch: string | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch) return false;
  const current = opaqueTag(etag);
  return ifNoneMatch
    .split(',')
    .some((candidate) => {
      const trimmed = candidate.trim();
      return trimmed === '*' || opaqueTag(trimmed) === current;
    });
}

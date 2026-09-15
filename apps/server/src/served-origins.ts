/**
 * The served origins of one deployment.
 *
 * A deployment holds one list of origins that it serves. The cookie write
 * check, the trusted list of the identity routes, and the Host allowlist all
 * read that one list, so no two of them can answer "is this origin ours" with
 * a different set. See
 * [decision 0039](../../../docs/decisions/0039-one-list-of-served-origins.md).
 *
 * The operator names each origin in full. This module adds no scheme and no
 * port, and it refuses a value that is not exactly one origin.
 */

/** The parsed list, or the reasons that the configured values were refused. */
export type ServedOriginsResult =
  | { readonly ok: true; readonly origins: readonly string[] }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * The origin form of one configured value, or `null` when it is not one.
 *
 * The result carries the scheme, the host, and the port, and it drops the port
 * when that port is the default port of the scheme. A browser writes the
 * `Origin` header in the same form, so the two compare directly. A value that
 * carries a path, a query, a fragment, or a credential names more than an
 * origin, so it is refused rather than trimmed.
 */
export function readOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '' && url.pathname !== '/') return null;
  if (url.search !== '' || url.hash !== '') return null;
  return url.origin;
}

/** The scheme of an origin that `readOrigin` returned. */
function schemeOf(origin: string): string {
  return origin.startsWith('https://') ? 'https' : 'http';
}

/**
 * Builds the served origin list of one deployment.
 *
 * The canonical origin is always the first entry. It keeps the roles that need
 * exactly one value: the base URL of the identity routes, the secure cookie
 * flag, and the default listening port. Every entry uses the scheme of the
 * canonical origin, because one cookie policy serves the whole list and a
 * secure cookie never reaches a plain HTTP page.
 *
 * @param canonical the value of `NOTESAPP_ORIGIN`.
 * @param additional the value of `NOTESAPP_ADDITIONAL_ORIGINS`, or undefined.
 */
export function readServedOrigins(
  canonical: string,
  additional: string | undefined,
): ServedOriginsResult {
  const issues: string[] = [];
  const canonicalOrigin = readOrigin(canonical);
  if (canonicalOrigin === null)
    issues.push(
      'NOTESAPP_ORIGIN: name one full origin, with its scheme and, when the port is not the default port of that scheme, its port. An example is https://notes.example.com.',
    );
  const origins: string[] = canonicalOrigin === null ? [] : [canonicalOrigin];
  for (const entry of (additional ?? '').split(',')) {
    if (entry.trim() === '') continue;
    const origin = readOrigin(entry);
    if (origin === null) {
      issues.push(
        'NOTESAPP_ADDITIONAL_ORIGINS: name each full origin, with its scheme and, when the port is not the default port of that scheme, its port. Separate two origins with a comma.',
      );
      continue;
    }
    if (origins.includes(origin)) {
      issues.push(
        'NOTESAPP_ADDITIONAL_ORIGINS: name each origin one time only.',
      );
      continue;
    }
    if (
      canonicalOrigin !== null &&
      schemeOf(origin) !== schemeOf(canonicalOrigin)
    ) {
      issues.push(
        'NOTESAPP_ADDITIONAL_ORIGINS: use the scheme of NOTESAPP_ORIGIN for each origin. One installation serves HTTP or HTTPS, because one cookie policy serves all of its origins.',
      );
      continue;
    }
    origins.push(origin);
  }
  if (issues.length > 0)
    return { ok: false, issues: Array.from(new Set(issues)) };
  return { ok: true, origins };
}

/**
 * The host names of the served origins, for the Host header allowlist.
 *
 * A `Host` header carries no scheme, so the allowlist can only hold the host
 * name of each served origin. The port is not held either: a reverse proxy in
 * front of the deployment decides what reaches the `Host` header, so a port
 * there proves nothing. The origin checks above are the ones that decide a
 * cookie authenticated write.
 */
export function servedHostNames(origins: readonly string[]): readonly string[] {
  return Array.from(new Set(origins.map((origin) => new URL(origin).hostname)));
}

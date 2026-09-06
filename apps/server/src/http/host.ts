/**
 * Host name parsing utilities for HTTP request validation.
 */

/**
 * Host header value without its port, lowercased.
 *
 * An IPv6 literal keeps its brackets, because `[::1]:8080` and `[::1]` name
 * the same host and a plain split on the colon would cut the address.
 */
export function hostName(host: string | undefined): string {
  const value = (host ?? '').trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(0, end + 1);
  }
  return value.split(':')[0] ?? '';
}

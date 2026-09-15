/**
 * The proxies that this deployment believes.
 *
 * A reverse proxy replaces the peer address of every request with its own, so
 * the client address arrives in a forwarded header. A header proves nothing on
 * its own: any caller that reaches the listening port can write one. The
 * operator therefore names the proxies, and this list grants the trust. An
 * empty list trusts nothing, which is the default of every deployment. See
 * [decision 0043](../../../docs/decisions/0043-one-decider-of-the-client-address.md).
 *
 * The parsed list goes to Fastify as `trustProxy`. Fastify walks the forwarded
 * chain from the right and stops at the first hop that this list does not
 * hold, so an entry that a client forged in front of a trusted proxy is
 * dropped.
 */
import { isIP } from 'node:net';

/** The parsed list, or the reason that the configured value was refused. */
export type TrustedProxiesResult =
  | { readonly ok: true; readonly proxies: readonly string[] }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * The ranges that carry a name.
 *
 * They are the names that Fastify's address matcher reads: the loopback
 * addresses, the link local addresses, and the addresses that only a private
 * network carries. A container platform gives a proxy an address of the last
 * range and changes it at each start, so a name is the one stable way to
 * describe that proxy.
 */
const namedRanges = ['loopback', 'linklocal', 'uniquelocal'] as const;

const prefixPattern = /^(0|[1-9][0-9]{0,2})$/;

/** Whether one entry names a range. */
function isNamedRange(value: string): boolean {
  return namedRanges.some((name) => name === value);
}

/** Whether one entry is an IP address or a range in CIDR form. */
function isAddressOrRange(value: string): boolean {
  const slash = value.lastIndexOf('/');
  const address = slash === -1 ? value : value.slice(0, slash);
  const family = isIP(address);
  if (family === 0) return false;
  if (slash === -1) return true;
  const prefix = value.slice(slash + 1);
  if (!prefixPattern.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Builds the trusted proxy list of one deployment.
 *
 * @param configured the value of `NOTESAPP_TRUSTED_PROXIES`, or undefined.
 */
export function readTrustedProxies(
  configured: string | undefined,
): TrustedProxiesResult {
  const issues: string[] = [];
  const proxies: string[] = [];
  for (const entry of (configured ?? '').split(',')) {
    const value = entry.trim();
    if (value === '') continue;
    if (!isNamedRange(value) && !isAddressOrRange(value)) {
      issues.push(
        'NOTESAPP_TRUSTED_PROXIES: name each proxy as an IP address, as a range in CIDR form, or as one of loopback, linklocal and uniquelocal. Separate two entries with a comma.',
      );
      continue;
    }
    if (proxies.includes(value)) {
      issues.push('NOTESAPP_TRUSTED_PROXIES: name each proxy one time only.');
      continue;
    }
    proxies.push(value);
  }
  if (issues.length > 0)
    return { ok: false, issues: Array.from(new Set(issues)) };
  return { ok: true, proxies };
}

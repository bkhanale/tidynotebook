/** The MCP authorization policy of record 0226. */
export const oauthScopes = [
  'notes:read',
  'notes:write',
  'offline_access',
] as const;
export const oauthGrantTypes = ['authorization_code', 'refresh_token'] as const;
export const oauthAccessLifetimeSeconds = 60 * 60;
export const oauthRefreshLifetimeSeconds = 30 * 24 * 60 * 60;
export const oauthUnusedClientDays = 30;
export const maxOAuthClients = 1000;

/** Read access is always present. Write access is an optional addition. */
export function oauthScopeAllowed(value: string): boolean {
  const scopes = value.split(' ');
  return (
    scopes.includes('notes:read') &&
    scopes.every((scope) => oauthScopes.some((known) => known === scope))
  );
}

/** The person can give a subset of the requested access. */
export function oauthConsentScopeAllowed(
  requested: string,
  accepted: string,
): boolean {
  return (
    oauthScopeAllowed(accepted) &&
    accepted.split(' ').every((scope) => requested.split(' ').includes(scope))
  );
}

/** A client name and its claimed links cannot establish its identity (0226). */
export type OAuthClientIdentity =
  | { readonly kind: 'cimd'; readonly host: string }
  | { readonly kind: 'unverified' }
  | { readonly kind: 'invalid' };

/** Only the host of a CIMD document is an identity for display. */
export function oauthClientIdentity(raw: string): OAuthClientIdentity {
  if (!raw.startsWith('https://')) return { kind: 'unverified' };
  const address = oauthAddress(raw);
  if (address === null || address.protocol !== 'https:' || address.hash !== '')
    return { kind: 'invalid' };
  return { kind: 'cimd', host: address.host };
}

export type OAuthRedirectAddress =
  | { readonly kind: 'web'; readonly host: string; readonly loopback: boolean }
  | { readonly kind: 'native' }
  | { readonly kind: 'invalid' };

/** Parse an external address without I/O. Refuse credentials and ambiguous bytes. */
function oauthAddress(raw: string): URL | null {
  if (
    Array.from(raw).some(
      (character) =>
        character.charCodeAt(0) <= 0x20 ||
        character.charCodeAt(0) === 0x7f ||
        character === '\\',
    )
  )
    return null;
  try {
    const address = new URL(raw);
    return address.username === '' && address.password === '' ? address : null;
  } catch {
    return null;
  }
}

/** The redirect host, or the warning category for an app on this computer. */
export function oauthRedirectAddress(raw: string): OAuthRedirectAddress {
  const address = oauthAddress(raw);
  if (address === null) return { kind: 'invalid' };
  if (address.protocol !== 'https:' && address.protocol !== 'http:') {
    if (['javascript:', 'data:', 'file:', 'blob:'].includes(address.protocol))
      return { kind: 'invalid' };
    return { kind: 'native' };
  }
  if (address.hostname === '') return { kind: 'invalid' };
  return {
    kind: 'web',
    host: address.host,
    loopback:
      address.hostname === 'localhost' ||
      address.hostname === '[::1]' ||
      /^127\./.test(address.hostname),
  };
}

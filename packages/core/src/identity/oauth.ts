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

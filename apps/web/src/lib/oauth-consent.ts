/** The facts and choices of MCP consent (record 0226). No client claim is identity. */
import type { Account, OAuthPublicClient } from '@notesapp/api-client';
import {
  oauthClientIdentity,
  oauthRedirectAddress,
  oauthScopeAllowed,
  productName,
} from '@notesapp/core';
import { queryValue, queryValues } from './address-query.ts';
import { signInAddress } from './sign-in-return.ts';

export const oauthConsentRoute = '/oauth/consent';
export const oauthSignInRoute = '/oauth/sign-in';

export type OAuthAccess = 'read' | 'write';
export const oauthAccessChoices = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read and write' },
] as const;

export type OAuthRequest = {
  /** The original query, without the leading question mark. Never serialize it again. */
  readonly query: string;
  readonly clientId: string;
  readonly redirect: string;
  readonly scopes: readonly string[];
  readonly writeRequested: boolean;
};

/** Parse only what the page needs. The server checks the signature on each answer. */
export function oauthRequest(search: string): OAuthRequest | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (query.length === 0 || query.length > 4096) return null;
  const required = ['client_id', 'redirect_uri', 'scope', 'sig', 'exp'];
  if (
    required.some(
      (key) => queryValues(query, key)?.length !== 1 || !queryValue(query, key),
    )
  )
    return null;
  const clientId = queryValue(query, 'client_id') ?? '';
  const redirect = queryValue(query, 'redirect_uri') ?? '';
  const scope = queryValue(query, 'scope') ?? '';
  if (
    !oauthScopeAllowed(scope) ||
    oauthRedirectAddress(redirect).kind === 'invalid'
  )
    return null;
  return {
    query,
    clientId,
    redirect,
    scopes: scope.split(' '),
    writeRequested: scope.split(' ').includes('notes:write'),
  };
}

export type OAuthConsentFacts = {
  readonly claimedName: string;
  readonly clientHost: string | null;
  readonly redirectHost: string | null;
  readonly localWarning: string | null;
  readonly writeRequested: boolean;
  readonly accessSentence: string;
};

/** Identity comes from the CIMD address, never from a name, logo, or client_uri. */
export function oauthConsentFacts(
  request: OAuthRequest,
  client: OAuthPublicClient,
): OAuthConsentFacts | null {
  if (client.client_id !== request.clientId) return null;
  const target = oauthRedirectAddress(request.redirect);
  const identity = oauthClientIdentity(client.client_id);
  if (target.kind === 'invalid' || identity.kind === 'invalid') return null;
  return {
    claimedName: client.client_name?.trim() || 'No name given',
    clientHost: identity.kind === 'cimd' ? identity.host : null,
    redirectHost: target.kind === 'web' ? target.host : null,
    localWarning:
      target.kind === 'native' || target.loopback
        ? 'Your answer goes to an app on this computer.'
        : null,
    writeRequested: request.writeRequested,
    accessSentence: request.writeRequested
      ? 'This client asks to read and change notes in all your workspaces.'
      : 'This client asks to read notes in all your workspaces.',
  };
}

/** Keep requested background access when the person removes write access. */
export function oauthAcceptedScope(
  request: OAuthRequest,
  access: OAuthAccess,
): string {
  return request.scopes
    .filter(
      (scope) =>
        scope !== 'notes:write' ||
        (request.writeRequested && access === 'write'),
    )
    .join(' ');
}

export type OAuthPageStep =
  | { readonly kind: 'wait' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'sign-in'; readonly address: string }
  | { readonly kind: 'locked'; readonly message: string }
  | { readonly kind: 'ready'; readonly request: OAuthRequest };

/** Consent needs a live session and an active account. Keep its signed return whole. */
export function oauthPageStep(
  session: {
    readonly status: 'loading' | 'signed-in' | 'signed-out';
    readonly account: Pick<Account, 'controls' | 'accountPortal'> | null;
  },
  route: typeof oauthConsentRoute | typeof oauthSignInRoute,
  search: string,
): OAuthPageStep {
  if (session.status === 'loading') return { kind: 'wait' };
  const request = oauthRequest(search);
  if (request === null) return { kind: 'invalid' };
  if (session.status === 'signed-out' || session.account === null)
    return {
      kind: 'sign-in',
      address: signInAddress(`${route}?${request.query}`),
    };
  if (session.account.controls.standing === 'locked')
    return {
      kind: 'locked',
      message: session.account.accountPortal
        ? 'Your account is locked. Open your account and use billing to unlock it.'
        : 'Your account is locked. Ask the administrator to unlock it.',
    };
  return { kind: 'ready', request };
}

export const oauthInvalidMessage =
  'This access request cannot open. Go back to the client and connect again.';

/** OAuth descriptions are protocol values. Only the agreed grant limit has page copy. */
export function oauthFailureMessage(error: unknown, status: number): string {
  if (error !== null && typeof error === 'object') {
    const fields = Object.fromEntries(Object.entries(error));
    if (
      fields['error'] === 'invalid_request' &&
      fields['error_description'] === 'oauth_grant_limit'
    )
      return 'This account has too many connected apps. Open Settings and remove an app, then try again.';
  }
  return status === 0 || status >= 500 || status === 429
    ? 'The request did not finish. Check your connection, then go back to the client and connect again.'
    : oauthInvalidMessage;
}

/** The form states its purpose before the person gives a password. */
export const oauthSignInDescription = `Sign in to connect an app to ${productName}. Then choose what it can do.`;
export const oauthResetSentence =
  'After you reset your password, go back to the app and start the connection again.';

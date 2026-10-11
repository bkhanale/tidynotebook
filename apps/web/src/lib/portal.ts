/**
 * How a person reaches the account portal of the operator (record 0190).
 *
 * The installation can name an account portal. Settings opens it for any
 * standing, and the screen of a locked account opens it to unlock the
 * account (record 0201). A page of the portal, and a message that it sends,
 * can link a person back to `/portal?path=<path>` of this application. That
 * route opens the handoff to the path that the link names, after sign-in
 * when the person has no session.
 *
 * The path comes from the address bar, so the route takes only a path that
 * the contract takes and opens the root of the portal for any other value.
 * Every decision of the route lives here, so the screen holds none of it.
 */
import type { Account } from '@notesapp/api-client';
import { queryAddress, queryValue } from './address-query.ts';
import { signInAddress } from './sign-in-return.ts';

/** The route of the application that opens the portal. */
export const portalRoute = '/portal';

/** The query member of the route that names the portal path. */
export const portalPathParameter = 'path';

/** The root of the portal, which every invalid path opens instead. */
export const portalHome = '/';

/**
 * A portal path, as `PortalPath` of the contract states it: one slash, then
 * parts of letters, digits and the marks of an address, none of them empty
 * and none of them starting with a dot. `tests/integration/locked-account.test.ts`
 * holds this copy to the validator of the contract.
 */
const portalPathPattern = /^(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*\/?$/;

/** The longest portal path that the contract takes. */
const maxPortalPathLength = 256;

/** The portal path of a raw value, or the root for any value that is not one. */
export function portalPath(raw: string | null): string {
  if (raw === null || raw === '' || raw.length > maxPortalPathLength)
    return portalHome;
  return portalPathPattern.test(raw) ? raw : portalHome;
}

/** The portal path that the query of the route names. */
export function portalPathOf(search: string): string {
  return portalPath(queryValue(search, portalPathParameter));
}

/** The address of the route that opens one path of the portal. */
export function portalAddress(path: string): string {
  return queryAddress(portalRoute, portalPathParameter, portalPath(path));
}

/** What the route does now. */
export type PortalStep =
  | { readonly kind: 'wait' }
  | { readonly kind: 'sign-in'; readonly address: string }
  | { readonly kind: 'no-portal' }
  | { readonly kind: 'open'; readonly path: string };

/**
 * The step of the route for a session and the query of its address.
 *
 * A session that loads waits. No session goes to sign-in, which comes back
 * to the same route with the same path. An installation that names no
 * portal says so. Any account opens the portal, active or locked, because
 * a locked account opens it to unlock itself (record 0201).
 */
export function portalStep(
  session: {
    readonly status: 'loading' | 'signed-in' | 'signed-out';
    readonly account: Pick<Account, 'accountPortal'> | null;
  },
  search: string,
): PortalStep {
  const path = portalPathOf(search);
  if (session.status === 'loading') return { kind: 'wait' };
  if (session.status === 'signed-out' || session.account === null)
    return { kind: 'sign-in', address: signInAddress(portalAddress(path)) };
  if (!session.account.accountPortal) return { kind: 'no-portal' };
  return { kind: 'open', path };
}

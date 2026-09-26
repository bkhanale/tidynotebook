/**
 * The rules of registration and of an invitation (record 0108).
 *
 * An account comes in through one registration path. This module holds the
 * checks that the transport and the operator commands share before they call
 * that path, and the defaults that the configuration starts from. The
 * database function behind `RegistrationStore.register` refuses the same
 * calls again, so a caller that skips a check here is still refused.
 */
import { fail, ok, type Result } from '../files/model.ts';
import type { RegistrationRequest, RegistrationStore } from './ports.ts';

/**
 * The shape of an invitation token: 32 random bytes in base64url, with no
 * padding. The contract states the same pattern.
 */
export const invitationTokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** The longest sign-in address. The contract states the same bound. */
export const maxEmailLength = 320;

/** How long an invitation stays valid when the configuration names nothing. */
export const defaultInvitationLifetimeHours = 7 * 24;

/** The longest lifetime that the configuration accepts: one year. */
export const maxInvitationLifetimeHours = 365 * 24;

/** The byte limit of a new account when the configuration names nothing. */
export const defaultAccountLimitBytes = 5n * 1024n * 1024n * 1024n;

/**
 * The largest byte limit, which is the largest integer that a JSON number
 * carries without loss.
 */
export const maxAccountLimitBytes = BigInt(Number.MAX_SAFE_INTEGER);

/** The name of the workspace that every new account starts with. */
export const personalWorkspaceName = 'Personal';

/**
 * The one written form of a sign-in address, or `null` for a text that is not
 * one.
 *
 * An address is compared in lower case everywhere, so an invitation binds the
 * address that the identity user stores. The check is the shape only; the
 * contract validates the format before a value reaches this function.
 */
export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > maxEmailLength) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1)
    return null;
  return email;
}

/** The instant at which an invitation made now expires, as ISO 8601. */
export function invitationExpiry(now: Date, lifetimeHours: number): string {
  return new Date(now.getTime() + lifetimeHours * 60 * 60 * 1000).toISOString();
}

/** Whether an invitation still opens anything at one instant. */
export function invitationState(
  invitation: { readonly expiresAt: string },
  now: Date,
): 'pending' | 'expired' {
  return Date.parse(invitation.expiresAt) > now.getTime()
    ? 'pending'
    : 'expired';
}

/**
 * Makes one account through the one registration path.
 *
 * A refusal of an invitation answers `invitation_invalid` whatever the
 * cause, so the answer does not say whether the token expired, was used, was
 * revoked, or never existed. A refused first run answers `forbidden`.
 */
export async function registerAccount(
  store: RegistrationStore,
  request: RegistrationRequest,
): Promise<Result<string>> {
  if (
    request.ground.kind === 'invitation' &&
    !/^[0-9a-f]{64}$/.test(request.ground.tokenDigest)
  )
    return fail('invitation_invalid');
  if (request.limitBytes < 1n || request.limitBytes > maxAccountLimitBytes)
    return fail('forbidden');
  const accountId = await store.register(request);
  if (accountId !== null) return ok(accountId);
  return fail(
    request.ground.kind === 'invitation' ? 'invitation_invalid' : 'forbidden',
  );
}

/** The address that a valid invitation binds, or the one refusal. */
export async function readInvitation(
  store: RegistrationStore,
  tokenDigest: string,
): Promise<Result<string>> {
  if (!/^[0-9a-f]{64}$/.test(tokenDigest)) return fail('invitation_invalid');
  const email = await store.invitationAddress(tokenDigest);
  return email === null ? fail('invitation_invalid') : ok(email);
}

/** What the installation has of the parts that open registration needs. */
export type OpenRegistrationReadiness = {
  /** A mail transport, so a verification link can reach an address. */
  readonly mail: boolean;
  /** A second origin for published pages (record 0118). */
  readonly publishedOrigin: boolean;
  /** The terms and the privacy notice (record 0120). */
  readonly legalDocuments: boolean;
};

/** One part that open registration needs (record 0114). */
export type OpenRegistrationPart =
  'mail' | 'published-origin' | 'legal-documents';

/** The parts that the installation lacks for open registration. */
export function openRegistrationMissing(
  readiness: OpenRegistrationReadiness,
): readonly OpenRegistrationPart[] {
  const missing: OpenRegistrationPart[] = [];
  if (!readiness.mail) missing.push('mail');
  if (!readiness.publishedOrigin) missing.push('published-origin');
  if (!readiness.legalDocuments) missing.push('legal-documents');
  return missing;
}

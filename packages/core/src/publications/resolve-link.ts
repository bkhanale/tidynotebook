/**
 * The resolve use case: does this address open a link now.
 *
 * The reader carries its credentials in the address, as decision 0046 states,
 * and the caller hands over their digests. This use case answers the link, or
 * the one refusal of the reader path.
 *
 * It reads the link record on every call, so a revocation takes effect at
 * once. It checks four facts in one order, and every failure takes the same
 * answer:
 *
 * ```text
 * no record for this token digest -> refuse (unknown)
 * the owner revoked the link      -> refuse (revoked)
 * the expiry has passed           -> refuse (expired)
 * the link waits for a password   -> refuse (locked)
 * ```
 *
 * The cause in the brackets goes to the refusal log and to nothing else. The
 * value that the caller receives is one value for the four, so a handler
 * cannot answer four ways.
 *
 * `openLink` serves the other use cases of this context inside their own
 * transaction. It is not a public name of the package, so no route can read a
 * link record without these four checks.
 */
import { ok, type Result } from '../files/model.ts';
import { refuseRead, type ReaderRefusalCause } from './errors.ts';
import { instantMs, type PublishedLink } from './model.ts';
import type { PublicationContext, PublicationReader } from './ports.ts';
import { isTicketUsable } from './ticket.ts';

/**
 * The credentials of one reader, as digests.
 *
 * The caller digests the token and the ticket of the address through the
 * `SecretDigest` port, so no raw secret enters the domain. `ticketDigest` is
 * `null` when the address carries no ticket.
 */
export type ReaderCredentials = {
  readonly tokenDigest: string;
  readonly ticketDigest: string | null;
};

/**
 * Why the record of this link opens nothing at this instant, or `null`.
 *
 * The rule reads the record only, so it needs no transaction and no reader. It
 * is the one place that states what a stopped link is, and both the read path
 * below and the unlock of the storage package ask it, so neither can drift
 * from the other.
 *
 * An expiry that cannot be read stops the link. A link that never stops must
 * hold no expiry at all, so the rule fails closed.
 */
export function linkRefusalCause(
  link: PublishedLink,
  now: number,
): ReaderRefusalCause | null {
  if (link.revokedAt !== null) return 'revoked';
  if (link.expiresAt === null) return null;
  const stop = instantMs(link.expiresAt);
  return stop === null || now >= stop ? 'expired' : null;
}

/**
 * Opens one link inside an open read.
 *
 * Internal to this context: it is exported for the sibling use cases and it is
 * not a name of `src/index.ts`.
 */
export async function openLink(
  context: PublicationContext,
  reader: PublicationReader,
  credentials: ReaderCredentials,
): Promise<Result<PublishedLink>> {
  const now = context.clock();
  const link = await reader.linkByTokenDigest(credentials.tokenDigest);
  if (link === null) return refuseRead(context.refusals, 'unknown');
  const stopped = linkRefusalCause(link, now);
  if (stopped !== null) return refuseRead(context.refusals, stopped);
  if (link.passwordProtected) {
    if (credentials.ticketDigest === null)
      return refuseRead(context.refusals, 'locked');
    const ticket = await reader.ticketOfLink(link, credentials.ticketDigest);
    if (ticket === null || !isTicketUsable(link, ticket, now))
      return refuseRead(context.refusals, 'locked');
  }
  return ok(link);
}

/** Answers the link that this address opens, or the one refusal. */
export function resolvePublishedLink(
  context: PublicationContext,
  credentials: ReaderCredentials,
): Promise<Result<PublishedLink>> {
  return context.store.read((reader) => openLink(context, reader, credentials));
}

/**
 * The ticket rule: how long an unlocked link stays open.
 *
 * A reading ticket is what the unlock answer gives to a reader that gave the
 * password of a link. Decision 0030 states three facts about it, and this file
 * holds all three:
 *
 * - The ticket belongs to one link. A ticket of another link opens nothing,
 *   so one password never opens a second link.
 * - The ticket lives 12 hours from the instant of the unlock.
 * - A read does not move the expiry. The expiry comes from the instant of the
 *   unlock only, so no later call can compute a longer life. The port of this
 *   context declares read methods only, so a read has no way to write a row
 *   either.
 *
 * The rule holds no secret. The ticket that a reader carries stays in the
 * address; the record here names the link, the instant of the unlock and the
 * instant at which the ticket stops.
 */
import { instantMs, type PublishedLink, type ReadingTicket } from './model.ts';

/** How long one reading ticket lives, in milliseconds. */
export const readingTicketLifetimeMs = 12 * 60 * 60 * 1000;

/**
 * The instant at which a ticket of this unlock stops.
 *
 * The answer reads from the instant of the unlock only, which is why a read
 * cannot move it. It is `null` when the instant cannot be read, and the unlock
 * then writes no ticket.
 */
export function readingTicketExpiry(issuedAt: string): string | null {
  const start = instantMs(issuedAt);
  if (start === null) return null;
  return new Date(start + readingTicketLifetimeMs).toISOString();
}

/**
 * Whether this ticket opens this link at this instant.
 *
 * A ticket of another link, a ticket whose expiry cannot be read, and a ticket
 * at or past its expiry all answer false. The rule fails closed.
 */
export function isTicketUsable(
  link: PublishedLink,
  ticket: ReadingTicket,
  now: number,
): boolean {
  if (ticket.publicationId !== link.publicationId) return false;
  const stop = instantMs(ticket.expiresAt);
  if (stop === null) return false;
  return now < stop;
}

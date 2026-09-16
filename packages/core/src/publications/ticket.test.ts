/**
 * The ticket rule.
 *
 * The rule holds the three facts of decision 0030: one link, 12 hours, and an
 * expiry that a read does not move.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublishedLink, ReadingTicket } from './model.ts';
import {
  isTicketUsable,
  readingTicketExpiry,
  readingTicketLifetimeMs,
} from './ticket.ts';

const hour = 60 * 60 * 1000;
const link: PublishedLink = {
  publicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scope: { kind: 'note', fileId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
  createdAt: '2026-09-16T07:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  passwordProtected: true,
};
const issuedAt = '2026-09-16T08:00:00.000Z';
const unlocked = Date.parse(issuedAt);

/** One ticket of the link above. */
function ticketOf(over: Partial<ReadingTicket> = {}): ReadingTicket {
  return {
    publicationId: link.publicationId,
    issuedAt,
    expiresAt: readingTicketExpiry(issuedAt) ?? issuedAt,
    ...over,
  };
}

await test('a ticket lives 12 hours from the unlock', () => {
  assert.equal(readingTicketLifetimeMs, 12 * hour);
  assert.equal(readingTicketExpiry(issuedAt), '2026-09-16T20:00:00.000Z');
});

await test('the expiry reads the unlock and nothing else', () => {
  const first = readingTicketExpiry(issuedAt);
  const second = readingTicketExpiry(issuedAt);
  assert.equal(first, second);
  // A later instant gives a later expiry only for a later unlock.
  assert.equal(
    readingTicketExpiry('2026-09-16T09:00:00.000Z'),
    '2026-09-16T21:00:00.000Z',
  );
});

await test('a ticket works up to its expiry and not at it', () => {
  const ticket = ticketOf();
  assert.equal(isTicketUsable(link, ticket, unlocked), true);
  assert.equal(isTicketUsable(link, ticket, unlocked + 11 * hour), true);
  assert.equal(isTicketUsable(link, ticket, unlocked + 12 * hour), false);
  assert.equal(isTicketUsable(link, ticket, unlocked + 13 * hour), false);
});

await test('a ticket of another link is refused', () => {
  const other = ticketOf({
    publicationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  });
  assert.equal(isTicketUsable(link, other, unlocked + hour), false);
});

await test('an unreadable instant refuses', () => {
  assert.equal(readingTicketExpiry('the morning'), null);
  assert.equal(
    isTicketUsable(link, ticketOf({ expiresAt: 'the evening' }), unlocked),
    false,
  );
});

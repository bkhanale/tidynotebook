/**
 * The token, the link and the mail of one invitation (record 0108).
 *
 * The administrator operation and the operator command `pnpm account:invite`
 * both issue an invitation here, so the two make the same token, keep the
 * same digest and write the same link. The token travels in the fragment of
 * the link, so a server log and a `Referer` header never hold it.
 */
import { randomUUID } from 'node:crypto';
import type { NewInvitation } from '@notesapp/core';
import { invitationExpiry } from '@notesapp/core';
import type { MailTransport } from './mail.ts';
import { invitationMessage } from './messages.ts';
import { newPublishedSecret, secretDigest } from './publication-secrets.ts';

/**
 * The path of the page that accepts an invitation. The router of the web
 * application serves the same path.
 */
export const invitationPath = '/invitation';

/** One invitation that is ready to store, and the link that opens it. */
export type IssuedInvitation = {
  /** What the store keeps. It holds the digest and never the token. */
  readonly record: NewInvitation;
  /** The link, which holds the token. It is shown once or mailed. */
  readonly link: string;
};

/**
 * Issues one invitation for one address.
 *
 * The token has the shape of a reader secret: 32 random bytes in base64url.
 */
export function issueInvitation(input: {
  readonly origin: string;
  readonly email: string;
  readonly lifetimeHours: number;
  readonly mailed: boolean;
  readonly now: Date;
}): IssuedInvitation {
  const token = newPublishedSecret();
  return {
    record: {
      invitationId: randomUUID(),
      tokenDigest: secretDigest.digest(token),
      email: input.email,
      expiresAt: invitationExpiry(input.now, input.lifetimeHours),
      mailed: input.mailed,
    },
    link: `${input.origin}${invitationPath}#${token}`,
  };
}

/** Sends the link of one invitation to its address. */
export async function mailInvitation(
  mail: MailTransport,
  input: {
    readonly origin: string;
    readonly email: string;
    readonly link: string;
    readonly lifetimeHours: number;
  },
): Promise<void> {
  await mail.send(
    invitationMessage({
      to: input.email,
      supportUrl: mail.supportUrl ?? null,
      origin: input.origin,
      link: input.link,
      lifetimeHours: input.lifetimeHours,
    }),
  );
}

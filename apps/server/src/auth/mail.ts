/**
 * The mail transport of the server.
 *
 * A deployment without `NOTESAPP_SMTP_URL` has no transport. Recovery by email
 * is then disabled and the documented path is the operator command
 * `pnpm account:recover`. This module never writes an address, a subject, or a
 * token to a log. `messages.ts` writes the words of every message.
 */
import { createTransport } from 'nodemailer';
import type { MailConfig } from '../config.ts';

/** One message that the server sends. */
export type MailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

/** Sends one message. */
export type MailTransport = {
  send(message: MailMessage): Promise<void>;
};

/**
 * The headers of every message.
 *
 * Each message is written by a program in answer to an event, so it says so
 * (RFC 3834). A vacation responder then does not answer it, and a mail server
 * of Microsoft does not send an automatic reply either.
 */
export const automaticHeaders: Readonly<Record<string, string>> = {
  'Auto-Submitted': 'auto-generated',
  'X-Auto-Response-Suppress': 'All',
};

/** What the transport library receives for one message. */
export function envelopeOf(
  from: string,
  message: MailMessage,
): {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
} {
  return {
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    headers: automaticHeaders,
  };
}

/**
 * Builds the transport of a deployment, or `null` when none is configured.
 *
 * A test supplies its own transport instead, so no integration check needs a
 * mail server.
 */
export function createMailTransport(
  mail: MailConfig | null,
): MailTransport | null {
  if (mail === null) return null;
  const transport = createTransport(mail.smtpUrl);
  return {
    async send(message: MailMessage): Promise<void> {
      await transport.sendMail({ ...envelopeOf(mail.from, message) });
    },
  };
}

/**
 * A transport that sends a message only while its address has budget left
 * (record 0141).
 *
 * A person with no session can cause a message to any address: a sign-up, a
 * repeated sign-up and a password reset. Each of those goes through this one
 * transport, so no sender can skip the budget. A message over the budget is
 * dropped in silence, because the answer to the person who caused it must
 * stay the same whatever the address is.
 */
export function budgetedTransport(
  transport: MailTransport | null,
  mayMail: (address: string) => Promise<boolean>,
): MailTransport | null {
  if (transport === null) return null;
  return {
    async send(message: MailMessage): Promise<void> {
      if (!(await mayMail(message.to))) return;
      await transport.send(message);
    },
  };
}

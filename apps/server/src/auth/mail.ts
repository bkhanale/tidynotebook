/**
 * The mail transport of local password recovery.
 *
 * A deployment without `NOTESAPP_SMTP_URL` has no transport. Recovery by email
 * is then disabled and the documented path is the operator command
 * `pnpm account:recover`. This module never writes an address, a subject, or a
 * token to a log.
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
      await transport.sendMail({
        from: mail.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

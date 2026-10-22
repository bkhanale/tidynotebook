/** Every server email, from one content value for both parts (record 0232). */
import { productName } from '@notesapp/core';
import { renderEmail, type EmailContent } from './email-template.ts';
import type { MailMessage } from './mail.ts';

/** The host of the installation, from configuration rather than a request. */
export function installationHost(origin: string): string {
  return new URL(origin).host;
}

/** A time in hours, using whole days where possible. */
export function lifetimeWords(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${String(days)} days`;
  }
  return hours === 1 ? '1 hour' : `${String(hours)} hours`;
}

type MessageInput = {
  readonly to: string;
  readonly origin: string;
  readonly supportUrl?: string | null;
};
type LinkInput = MessageInput & {
  readonly link: string;
  readonly lifetimeHours: number;
};

function signature(origin: string): string {
  return `${productName} at ${installationHost(origin)}`;
}

function message(
  input: MessageInput,
  subject: string,
  content: EmailContent,
): MailMessage {
  return {
    to: input.to,
    subject,
    ...renderEmail({ ...input, subject, content }),
  };
}

/** A new invitation, for its recipient only. */
export function invitationMessage(input: LinkInput): MailMessage {
  const name = signature(input.origin);
  const lifetime = `The link works once, for ${lifetimeWords(input.lifetimeHours)}.`;
  return message(input, `Your invitation to ${name}`, {
    label: 'Invitation',
    heading: 'Your notebook is ready to start',
    preview: `Choose a password to make your account. ${lifetime}`,
    paragraphs: [
      `You have an invitation to make an account on ${name}.`,
      'Write in Markdown, keep drafts offline, and use version history to return to earlier work.',
      'Choose a password to accept your invitation. This link is for you. Do not share it.',
    ],
    action: { label: 'Accept invitation', url: input.link },
    lifetime,
    panel: 'If you do not want an account, ignore this message.',
    reason: `You get this message because an administrator invited this address to ${name}.`,
  });
}

/** Address verification for an open sign-up. */
export function verificationMessage(input: LinkInput): MailMessage {
  const name = signature(input.origin);
  const lifetime = `The link works for ${lifetimeWords(input.lifetimeHours)}.`;
  return message(input, `Finish your account on ${name}`, {
    label: 'Address check',
    heading: 'Finish your account',
    preview: `Confirm your email address to start. ${lifetime}`,
    paragraphs: [
      `Somebody asked for an account on ${name} with this address.`,
      'Confirm that the address is yours to finish your account.',
      'Write in Markdown, keep drafts offline, and use version history to return to earlier work.',
    ],
    action: { label: 'Confirm email address', url: input.link },
    lifetime,
    panel:
      'If you did not ask for an account, ignore this message. Without the link, no account is made.',
    reason: `You get this message because somebody asked to make an account on ${name} with this address.`,
  });
}

/** A sign-up attempt with an address that already has an account. */
export function signUpAttemptMessage(input: MessageInput): MailMessage {
  const name = signature(input.origin);
  return message(
    input,
    `Somebody tried to make an account on ${name} with your address`,
    {
      label: 'Account notice',
      heading: 'You already have an account',
      preview: 'A new sign-up used your address. Your account has not changed.',
      paragraphs: [
        `Somebody asked for a new account on ${name} with this address. The address already has an account, so nothing changed.`,
        'To sign in, open the sign-in page. If you do not know your password, select Forgot password on that page.',
      ],
      action: { label: 'Sign in', url: `${input.origin}/login` },
      panel:
        'If you asked for the account yourself, you already have one. Otherwise, ignore this message.',
      reason: `You get this message because a sign-up on ${name} used the address of your existing account.`,
    },
  );
}

/** A password reset link. */
export function passwordResetMessage(input: LinkInput): MailMessage {
  const name = signature(input.origin);
  const lifetime = `The link works once, for ${lifetimeWords(input.lifetimeHours)}.`;
  return message(input, `Reset your password on ${name}`, {
    label: 'Password reset',
    heading: 'Reset your password',
    preview: `Choose a new password. ${lifetime}`,
    paragraphs: [
      `Somebody asked to reset the password of your account on ${name}.`,
      'Choose a new password with the link below. This link is for you. Do not share it.',
    ],
    action: { label: 'Choose a new password', url: input.link },
    lifetime,
    panel:
      'If you did not ask for a new password, ignore this message. Your password does not change.',
    reason: `You get this message because somebody asked for a password reset on ${name}.`,
  });
}

/** Confirmation after a password reset. */
export function passwordChangedMessage(input: MessageInput): MailMessage {
  const name = signature(input.origin);
  return message(input, `Your password on ${name} changed`, {
    label: 'Security notice',
    heading: 'Your password changed',
    preview: 'Your password changed. If this was not you, reset it at once.',
    paragraphs: [
      `The password of your account on ${name} changed. Every device that was signed in is signed out.`,
      'If you changed it, you need to do nothing.',
    ],
    action: {
      label: 'Reset your password',
      url: `${input.origin}/forgot-password`,
    },
    panel:
      'If you did not change it, reset your password at once on this page, and then tell an administrator.',
    reason: `You get this message because the password of your account on ${name} changed.`,
  });
}

/** An administrator checks mail delivery and both message parts. */
export function testMessage(input: MessageInput): MailMessage {
  const name = signature(input.origin);
  return message(input, `Test message from ${name}`, {
    label: 'Mail test',
    heading: 'Your test message arrived',
    preview:
      'Check that the formatted message and its plain text version both read well.',
    paragraphs: [
      `This message checks the mail settings of ${name}.`,
      'It arrived, so invitations, sign-up links and password resets can reach a person too.',
      'This message has a formatted version and a plain text version. Check both in your mail application.',
    ],
    action: { label: 'Open your notebook', url: `${input.origin}/` },
    panel:
      'If this message is in your spam folder, ask your mail administrator to check the sender settings.',
    reason: `You get this message because an administrator asked ${name} to send a mail test to this address.`,
  });
}

/** A warning before a locked account is removed, with or without billing. */
export function removalNoticeMessage(
  input: MessageInput & {
    readonly days: number;
    readonly portal: boolean;
  },
): MailMessage {
  const name = signature(input.origin);
  const when = lifetimeWords(input.days * 24);
  return message(input, `Your account on ${name} is deleted in ${when}`, {
    label: 'Account removal',
    heading: 'Keep your account and notes',
    preview: `Your locked account and its notes will be deleted in ${when}.`,
    warning: true,
    paragraphs: [
      `Your account on ${name} is locked. In ${when}, the account and every note in it are deleted for good.`,
      input.portal
        ? 'To keep the account, sign in on this page and open billing.'
        : `To keep the account, ask the administrator of ${name} to unlock it. You can sign in on this page.`,
      'To keep your notes without the account, sign in and select Export my notes.',
    ],
    action: {
      label: 'Sign in to keep your account',
      url: `${input.origin}/login`,
    },
    panel: 'If you do not want the account, you need to do nothing.',
    reason: `You get this message because your account on ${name} is locked and is due for removal.`,
  });
}

/** Fixed, non-secret examples for golden files and visual review. */
import {
  invitationMessage,
  verificationMessage,
  signUpAttemptMessage,
  passwordResetMessage,
  passwordChangedMessage,
  testMessage,
  removalNoticeMessage,
} from '../messages.ts';

const base = { to: 'reader@example.test', origin: 'https://notes.example.com' };
export const emailExamples = [
  {
    name: 'invitation',
    message: invitationMessage({
      ...base,
      link: `${base.origin}/invitation#EXAMPLE-NOT-A-REAL-TOKEN`,
      lifetimeHours: 168,
      inviterName: 'Alex Morgan',
    }),
  },
  {
    name: 'verification',
    message: verificationMessage({
      ...base,
      link: `${base.origin}/verify#EXAMPLE-NOT-A-REAL-TOKEN`,
      lifetimeHours: 24,
    }),
  },
  { name: 'sign-up-attempt', message: signUpAttemptMessage(base) },
  {
    name: 'password-reset',
    message: passwordResetMessage({
      ...base,
      link: `${base.origin}/reset-password#EXAMPLE-NOT-A-REAL-TOKEN`,
      lifetimeHours: 1,
    }),
  },
  {
    name: 'password-changed',
    message: passwordChangedMessage({
      ...base,
      changedAt: '2026-10-23T14:05:00Z',
    }),
  },
  { name: 'test-message', message: testMessage(base) },
  ...[30, 7].flatMap((days) =>
    [true, false].map((portal) => ({
      name: `removal-${String(days)}-${portal ? 'billing' : 'administrator'}`,
      message: removalNoticeMessage({
        ...base,
        days,
        portal,
        removalAt: days === 7 ? '2026-10-30T00:30:00Z' : '2026-11-22T00:30:00Z',
      }),
    })),
  ),
  {
    name: 'support',
    message: testMessage({
      ...base,
      supportUrl: 'https://support.example.test/help?from=email&topic=account',
    }),
  },
  {
    name: 'long-addresses',
    message: invitationMessage({
      ...base,
      origin: `https://${'long-installation-name-'.repeat(2)}example.notes.example.com`,
      link: `https://${'long-installation-name-'.repeat(2)}example.notes.example.com/invitation#${'EXAMPLE-NOT-A-REAL-TOKEN-'.repeat(16)}`,
      supportUrl: `https://support.example.test/${'long-support-path/'.repeat(12)}`,
      inviterName: 'Alexandra ' + 'Longname'.repeat(14),
      lifetimeHours: 1,
    }),
  },
];

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installationHost,
  invitationMessage,
  lifetimeWords,
  passwordChangedMessage,
  passwordResetMessage,
  signUpAttemptMessage,
  verificationMessage,
} from './messages.ts';

const origin = 'https://notes.example.com';
const link = 'https://notes.example.com/page#secret-token';

const messages = [
  invitationMessage({ to: 'a@example.com', origin, link, lifetimeHours: 168 }),
  verificationMessage({ to: 'a@example.com', origin, link, lifetimeHours: 24 }),
  signUpAttemptMessage({ to: 'a@example.com', origin }),
  passwordResetMessage({ to: 'a@example.com', origin, link, lifetimeHours: 1 }),
  passwordChangedMessage({ to: 'a@example.com', origin }),
];

await test('a life in hours reads as a whole phrase with its count', () => {
  assert.equal(lifetimeWords(1), '1 hour');
  assert.equal(lifetimeWords(5), '5 hours');
  assert.equal(lifetimeWords(24), '1 day');
  assert.equal(lifetimeWords(168), '7 days');
  assert.equal(lifetimeWords(36), '36 hours');
});

await test('every message names the product and the installation', () => {
  assert.equal(installationHost('http://127.0.0.1:3000'), '127.0.0.1:3000');
  for (const message of messages) {
    assert.equal(message.to, 'a@example.com');
    assert.match(message.subject, /tidy notebook at notes\.example\.com/);
    assert.match(message.text, /tidy notebook at notes\.example\.com/);
    // The signature follows the delimiter of RFC 3676, so a mail program can
    // fold it away.
    assert.match(
      message.text,
      /\n-- \ntidy notebook at notes\.example\.com\n$/,
    );
    // No secret of a link reaches a subject, which a mailbox list shows.
    assert.equal(message.subject.includes('secret-token'), false);
    assert.equal(/[–—]/.test(message.text), false);
  }
});

await test('a link stands alone on its line, with its life', () => {
  const [invitation, verification, , reset] = messages;
  for (const message of [invitation, verification, reset])
    assert.ok(message?.text.split('\n').includes(link));
  assert.match(invitation?.text ?? '', /works once, for 7 days\./);
  assert.match(verification?.text ?? '', /works for 1 day\./);
  assert.match(reset?.text ?? '', /works once, for 1 hour\./);
});

await test('a message that changes nothing says what to do next', () => {
  const [, , attempt, , changed] = messages;
  assert.ok(
    attempt?.text.split('\n').includes('https://notes.example.com/login'),
  );
  assert.match(attempt?.text ?? '', /select Forgot password/);
  assert.ok(
    changed?.text
      .split('\n')
      .includes('https://notes.example.com/forgot-password'),
  );
});

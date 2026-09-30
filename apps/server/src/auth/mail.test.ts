import assert from 'node:assert/strict';
import test from 'node:test';
import {
  budgetedTransport,
  envelopeOf,
  type MailMessage,
  type MailTransport,
} from './mail.ts';

const message: MailMessage = {
  to: 'a@example.com',
  subject: 'Subject',
  text: 'Text\n',
};

await test('every message states that a program wrote it', () => {
  assert.deepEqual(envelopeOf('NotesApp <no-reply@example.com>', message), {
    from: 'NotesApp <no-reply@example.com>',
    to: 'a@example.com',
    subject: 'Subject',
    text: 'Text\n',
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    },
  });
});

await test('a budgeted transport sends while the address has budget', async () => {
  const sent: MailMessage[] = [];
  const inner: MailTransport = {
    send: (next) => {
      sent.push(next);
      return Promise.resolve();
    },
  };
  const asked: string[] = [];
  let left = 2;
  const transport = budgetedTransport(inner, (address) => {
    asked.push(address);
    left -= 1;
    return Promise.resolve(left >= 0);
  });
  assert.notEqual(transport, null);
  for (let attempt = 0; attempt < 3; attempt += 1)
    await transport?.send(message);
  // The third message is over the budget, and it goes nowhere in silence.
  assert.equal(sent.length, 2);
  assert.deepEqual(asked, ['a@example.com', 'a@example.com', 'a@example.com']);
  assert.equal(
    budgetedTransport(null, () => Promise.resolve(true)),
    null,
  );
});

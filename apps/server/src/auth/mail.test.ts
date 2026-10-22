import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransport } from 'nodemailer';
import { loadServerConfig } from '../config.ts';
import {
  budgetedTransport,
  envelopeOf,
  mailFailureReason,
  MailUnavailableError,
  noMailer,
  transportOptions,
  type Mailer,
  type MailMessage,
} from './mail.ts';

const message: MailMessage = {
  to: 'a@example.com',
  subject: 'Subject',
  text: 'Text\n',
  html: '<p>Text</p>',
};

await test('every message states that a program wrote it', () => {
  assert.deepEqual(
    envelopeOf('tidy notebook <no-reply@example.com>', message),
    {
      from: 'tidy notebook <no-reply@example.com>',
      to: 'a@example.com',
      subject: 'Subject',
      text: 'Text\n',
      html: '<p>Text</p>',
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
      },
    },
  );
});

await test('a display-name sender keeps its name and mailbox through the mail library', async () => {
  const transport = createTransport({ jsonTransport: true });
  const sent = await transport.sendMail({
    ...envelopeOf('"Name" <a@b>', message),
  });
  assert.deepEqual(sent.envelope, { from: 'a@b', to: ['a@example.com'] });
  const delivered: unknown = JSON.parse(String(sent.message));
  assert.ok(delivered !== null && typeof delivered === 'object');
  assert.deepEqual(Object.getOwnPropertyDescriptor(delivered, 'from')?.value, {
    address: 'a@b',
    name: 'Name',
  });
});

await test('a budgeted transport sends while the address has budget', async () => {
  const sent: MailMessage[] = [];
  const sendInner = (next: MailMessage): Promise<void> => {
    sent.push(next);
    return Promise.resolve();
  };
  const inner: Mailer = {
    available: () => Promise.resolve(true),
    current: () => Promise.resolve({ send: sendInner }),
    send: sendInner,
  };
  const asked: string[] = [];
  let left = 2;
  const transport = budgetedTransport(inner, (address) => {
    asked.push(address);
    left -= 1;
    return Promise.resolve(left >= 0);
  });
  assert.equal(await transport.available(), true);
  for (let attempt = 0; attempt < 3; attempt += 1)
    await transport.send(message);
  // The third message is over the budget, and it goes nowhere in silence.
  assert.equal(sent.length, 2);
  assert.deepEqual(asked, ['a@example.com', 'a@example.com', 'a@example.com']);
  // The transport of one operation keeps the budget too.
  const taken = await transport.current();
  await taken?.send(message);
  assert.equal(sent.length, 2);
  const none = budgetedTransport(noMailer, () => Promise.resolve(true));
  assert.equal(await none.current(), null);
  assert.equal(await none.available(), false);
  await assert.rejects(none.send(message), MailUnavailableError);
});

await test('each security mode of the settings reaches the transport', () => {
  const mail = {
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls' as const,
    username: 'notes',
    password: 'secret',
    sender: 'a@example.com',
  };
  assert.deepEqual(transportOptions(mail), {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    requireTLS: true,
    ignoreTLS: false,
    auth: { user: 'notes', pass: 'secret' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  const tls = transportOptions({ ...mail, security: 'tls', port: 465 });
  assert.equal(tls.secure, true);
  assert.equal(tls.requireTLS, false);
  const plain = transportOptions({
    ...mail,
    security: 'none',
    username: null,
    password: null,
    host: '[2001:db8::1]',
  });
  assert.equal(plain.ignoreTLS, true);
  assert.equal(plain.auth, undefined);
  assert.equal(plain.host, '2001:db8::1');
});

await test('a failure names only its kind', () => {
  assert.equal(mailFailureReason(new MailUnavailableError()), 'unavailable');
  assert.equal(mailFailureReason({ code: 'EAUTH' }), 'authentication');
  assert.equal(mailFailureReason({ responseCode: 535 }), 'authentication');
  assert.equal(mailFailureReason({ code: 'ETLS' }), 'security');
  assert.equal(
    mailFailureReason({ code: 'ESOCKET', message: 'wrong version number' }),
    'security',
  );
  assert.equal(
    mailFailureReason({ code: 'ESOCKET', message: 'reset' }),
    'connection',
  );
  assert.equal(mailFailureReason({ code: 'ECONNECTION' }), 'connection');
  assert.equal(mailFailureReason({ code: 'EENVELOPE' }), 'sender');
  assert.equal(mailFailureReason(new Error('x')), 'other');
  // The library throws an Error, whose message is not enumerable.
  const certificate = Object.assign(new Error('certificate has expired'), {
    code: 'ESOCKET',
  });
  assert.equal(mailFailureReason(certificate), 'security');
  assert.equal(mailFailureReason('x'), 'other');
});

await test('the mail fields of the environment build the transport of its URL', () => {
  // `smtps://me%40example.com:p%40ss%3Aw%2Frd%3F%23%25@smtp.example.com:465`
  // names this server. The fields name it with no percent encoding and reach
  // the transport with the same host, port, protection and sign-in.
  const config = loadServerConfig({
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL:
      'postgres://notesapp:notesapp@127.0.0.1:5432/notesapp',
    NOTESAPP_AUTH_DATABASE_URL:
      'postgres://notesapp_auth:notesapp_auth@127.0.0.1:5432/notesapp',
    NOTESAPP_STORAGE_ROOT: '/var/lib/notesapp',
    NOTESAPP_AUTH_SECRET: 'test-secret-value-for-integration-checks',
    NOTESAPP_MAX_BODY_BYTES: '1048576',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
    NOTESAPP_SMTP_HOST: 'smtp.example.com',
    NOTESAPP_SMTP_PORT: '465',
    NOTESAPP_SMTP_SECURITY: 'tls',
    NOTESAPP_SMTP_USERNAME: 'me@example.com',
    NOTESAPP_SMTP_PASSWORD: 'p@ss:w/rd?#%',
    NOTESAPP_MAIL_FROM: 'me@example.com',
  });
  assert.equal(config.mail?.kind, 'fields');
  if (config.mail?.kind !== 'fields') return;
  const options = transportOptions(config.mail.fields);
  assert.equal(options.host, 'smtp.example.com');
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.deepEqual(options.auth, {
    user: 'me@example.com',
    pass: 'p@ss:w/rd?#%',
  });
});

await test('the wire message has text first and HTML second, with automatic headers', async () => {
  const transport = createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  const sent = await transport.sendMail(
    envelopeOf('sender@example.test', message),
  );
  const wire = String(sent.message);
  assert.match(wire, /Content-Type: multipart\/alternative;/);
  assert.match(wire, /Auto-Submitted: auto-generated/);
  assert.ok(
    wire.indexOf('Content-Type: text/plain') <
      wire.indexOf('Content-Type: text/html'),
  );
  assert.match(wire, /<p>Text<\/p>/);
});

await test('every email type reaches the wire with both alternatives', async () => {
  const { emailExamples } = await import('./fixtures/email-examples.ts');
  const transport = createTransport({ streamTransport: true, buffer: true });
  for (const { name, message: example } of emailExamples) {
    const sent = await transport.sendMail(
      envelopeOf('sender@example.test', example),
    );
    const wire = String(sent.message);
    assert.match(wire, /Content-Type: multipart\/alternative;/, name);
    const plain = wire.indexOf('Content-Type: text/plain');
    const html = wire.indexOf('Content-Type: text/html');
    assert.ok(plain >= 0 && html > plain, name);
    assert.match(wire, /Auto-Submitted: auto-generated/, name);
  }
});

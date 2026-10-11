import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consentParts,
  consentTo,
  legalLinks,
  waitsForConsent,
} from './legal.ts';

await test('a consent names the versions that the page showed', () => {
  assert.deepEqual(
    consentTo({
      terms: { url: 'https://example.test/terms', version: '2026-09' },
      privacy: { url: 'https://example.test/privacy', version: '3' },
    }),
    { termsVersion: '2026-09', privacyVersion: '3' },
  );
});

await test('the application waits only when the server says so', () => {
  assert.equal(waitsForConsent({ consentRequired: true }), true);
  assert.equal(waitsForConsent({ consentRequired: false }), false);
});

await test('every screen links the terms first and then the privacy notice', () => {
  assert.deepEqual(
    legalLinks({
      terms: { url: 'https://notes.example.com/legal/terms', version: '1' },
      privacy: { url: 'https://example.test/privacy', version: '3' },
    }),
    [
      { label: 'Terms', href: 'https://notes.example.com/legal/terms' },
      { label: 'Privacy notice', href: 'https://example.test/privacy' },
    ],
  );
});

await test('the consent sentence links each document in its own words', () => {
  const parts = consentParts({
    terms: { url: 'https://notes.example.com/legal/terms', version: '1' },
    privacy: { url: 'https://example.test/privacy', version: '3' },
  });
  assert.deepEqual(parts, [
    { kind: 'text', text: 'I accept the ' },
    {
      kind: 'link',
      text: 'terms',
      href: 'https://notes.example.com/legal/terms',
    },
    { kind: 'text', text: ' and the ' },
    {
      kind: 'link',
      text: 'privacy notice',
      href: 'https://example.test/privacy',
    },
  ]);
  assert.equal(
    parts.map((part) => part.text).join(''),
    'I accept the terms and the privacy notice',
  );
});

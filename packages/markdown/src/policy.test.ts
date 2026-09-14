/**
 * URL policy checks.
 *
 * The renderer trusts `classifyUrl` completely, so every accepted form and
 * every rejected form is listed here rather than inferred from rendered HTML.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyUrl, isIdentifier } from './policy.ts';

const noteId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const attachmentId = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

await test('an identifier is accepted in either case', () => {
  assert.ok(isIdentifier(noteId));
  assert.ok(isIdentifier(noteId.toUpperCase()));
});

await test('a shape that is not a canonical identifier is rejected', () => {
  for (const value of [
    '',
    'not-a-uuid',
    '3f2504e0-4f89-41d3-9a0c-0305e82c330',
    '3f2504e0-4f89-41d3-9a0c-0305e82c33011',
    '3f2504e0_4f89_41d3_9a0c_0305e82c3301',
    // The nil and maximum identifiers are placeholders, not targets.
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    // A version or variant outside the defined set.
    '3f2504e0-4f89-91d3-9a0c-0305e82c3301',
    '3f2504e0-4f89-41d3-ca0c-0305e82c3301',
  ])
    assert.ok(!isIdentifier(value), value);
});

await test('the internal reference forms are accepted', () => {
  assert.deepEqual(classifyUrl(`/notes/${noteId}`), {
    kind: 'note',
    id: noteId,
    href: `/notes/${noteId}`,
  });
  assert.deepEqual(classifyUrl(`/attachments/${attachmentId}`), {
    kind: 'attachment',
    id: attachmentId,
    href: `/attachments/${attachmentId}`,
  });
});

await test('an identifier in upper case is normalized and the path is not', () => {
  assert.deepEqual(classifyUrl(`/notes/${noteId.toUpperCase()}`), {
    kind: 'note',
    id: noteId,
    href: `/notes/${noteId}`,
  });
  assert.deepEqual(classifyUrl(`/NOTES/${noteId}`), { kind: 'blocked' });
});

await test('the three external schemes are accepted', () => {
  for (const url of [
    'https://example.com/page',
    'http://example.com/page',
    'HTTPS://example.com/page',
    'mailto:someone@example.com',
  ])
    assert.deepEqual(classifyUrl(url), { kind: 'external', href: url }, url);
});

await test('every other scheme and shape is blocked', () => {
  for (const url of [
    '',
    '   ',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java script:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/file',
    '//evil.example.com/steal',
    '/notes/not-a-uuid',
    `/notes/${noteId}/extra`,
    `/notes/${noteId}?x=1`,
    `/attachments/${attachmentId}#fragment`,
    '/anything/else',
    '/',
  ])
    assert.deepEqual(classifyUrl(url), { kind: 'blocked' }, url);
});

await test('portable paths resolve inside the workspace tree', () => {
  assert.deepEqual(classifyUrl('../plan.md', 'projects/active/today.md'), {
    kind: 'relative',
    path: 'projects/plan.md',
    href: '../plan.md',
  });
  assert.deepEqual(
    classifyUrl('../../attachments/map%20one.png', 'projects/active/today.md'),
    {
      kind: 'relative',
      path: 'attachments/map one.png',
      href: '../../attachments/map%20one.png',
    },
  );
  assert.deepEqual(classifyUrl('../../outside.md', 'one/note.md'), {
    kind: 'blocked',
  });
});

await test('safe heading fragments are namespaced', () => {
  assert.deepEqual(classifyUrl('#a-fragment'), {
    kind: 'fragment',
    href: '#user-content-a-fragment',
  });
  assert.deepEqual(classifyUrl('#bad.fragment'), { kind: 'blocked' });
});

await test('surrounding white space is ignored', () => {
  assert.deepEqual(classifyUrl(`  /notes/${noteId}  `), {
    kind: 'note',
    id: noteId,
    href: `/notes/${noteId}`,
  });
});

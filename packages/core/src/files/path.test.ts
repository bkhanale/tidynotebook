/**
 * Path normalization rules.
 *
 * The tests cover NFC collisions, malformed paths, the Markdown suffix, the
 * attachment kind, case sensitivity, and the byte limits.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePath, type PathKind } from './path.ts';

/** The accepted value, or a test failure that names the rejected input. */
function accepted(input: string, kind: PathKind = 'note'): string {
  const result = normalizePath(input, kind);
  assert.equal(result.ok, true, `expected ${JSON.stringify(input)} to pass`);
  return result.ok ? result.value : '';
}

/** Checks that the input is rejected as an invalid path. */
function rejected(input: string, kind: PathKind = 'note'): void {
  const result = normalizePath(input, kind);
  assert.equal(result.ok, false, `expected ${JSON.stringify(input)} to fail`);
  if (!result.ok) {
    assert.equal(result.error.code, 'invalid_path');
    assert.deepEqual(result.error.fileIds, []);
  }
}

await test('a relative POSIX note path is accepted unchanged', () => {
  assert.equal(accepted('notes/2026/plan.md'), 'notes/2026/plan.md');
  assert.equal(accepted('plan.md'), 'plan.md');
});

await test('the composed and the decomposed name normalize to one path', () => {
  const composed = 'café.md';
  const decomposed = 'café.md';
  assert.notEqual(composed, decomposed);
  assert.equal(accepted(decomposed), composed);
  assert.equal(accepted(composed), accepted(decomposed));
});

await test('paths stay case sensitive', () => {
  assert.notEqual(accepted('Notes/A.md'), accepted('notes/a.md'));
  rejected('notes/a.MD');
});

await test('an absolute path is rejected', () => {
  rejected('/notes/plan.md');
});

await test('a traversal segment is rejected', () => {
  rejected('../plan.md');
  rejected('notes/../plan.md');
  rejected('./plan.md');
  rejected('notes/./plan.md');
  rejected('..');
});

await test('a backslash is rejected', () => {
  rejected('notes\\plan.md');
  rejected('notes/plan\\.md');
});

await test('a null byte and a control character are rejected', () => {
  rejected('notes/pl\u0000an.md');
  rejected('notes/pl\u000aan.md');
  rejected('notes/pl\u0009an.md');
  rejected('notes/plan\u007f.md');
  rejected('notes/plan\u009f.md');
});

await test('an empty segment and an empty path are rejected', () => {
  rejected('');
  rejected('notes//plan.md');
  rejected('notes/plan.md/');
});

await test('a note path must carry a Markdown name', () => {
  rejected('notes/plan');
  rejected('notes/plan.markdown');
  rejected('notes/.md');
  rejected('.md');
  assert.equal(accepted('notes/a.md'), 'notes/a.md');
});

await test('an attachment path needs no Markdown suffix', () => {
  assert.equal(
    accepted('attachments/photo.png', 'attachment'),
    'attachments/photo.png',
  );
  assert.equal(
    accepted('attachments/notes', 'attachment'),
    'attachments/notes',
  );
  assert.equal(accepted('report.md', 'attachment'), 'report.md');
  rejected('../photo.png', 'attachment');
  rejected('/photo.png', 'attachment');
});

await test('the byte limits count UTF-8 bytes', () => {
  assert.equal(accepted(`${'a'.repeat(252)}.md`).length, 255);
  rejected(`${'a'.repeat(253)}.md`);
  // Each two byte character costs two bytes of the 255 byte segment limit.
  assert.equal(accepted(`${'é'.repeat(126)}.md`).length, 129);
  rejected(`${'é'.repeat(127)}.md`);
  const directory = `${'b'.repeat(255)}/`;
  const fits = `${directory.repeat(3)}${'c'.repeat(252)}.md`;
  assert.equal(fits.length, 1023);
  assert.equal(accepted(fits), fits);
  rejected(`${directory.repeat(4)}${'c'.repeat(252)}.md`);
});

/**
 * Path normalization rules.
 *
 * The tests cover NFC collisions, malformed paths, the Markdown suffix, the
 * attachment kind, case sensitivity, and the byte limits.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanFolderPath,
  isStoredFolderPath,
  maxPathBytes,
  maxSegmentBytes,
  normalizePath,
  type PathKind,
} from './path.ts';

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

await test('a lone surrogate is rejected', () => {
  // A lone surrogate becomes U+FFFD in UTF-8, so two inputs would become one
  // stored path and the uniqueness rule would no longer hold.
  rejected('a\ud800b.md');
  rejected('a\udfffb.md');
  rejected('notes/\ud83d.md');
  // A complete pair is well formed and stays accepted.
  assert.equal(accepted('notes/\ud83d\ude00.md'), 'notes/\ud83d\ude00.md');
});

await test('a format character and a line separator are rejected', () => {
  // A zero width or bidirectional character makes two different names look
  // the same in the file tree.
  rejected('notes/pl\u202ean.md');
  rejected('notes/pl\u200ban.md');
  rejected('notes/pl\ufeffan.md');
  rejected('\ufeffnotes/plan.md');
  rejected('notes/pl\u2028an.md');
  rejected('notes/pl\u2029an.md');
});

await test('white space at the edge of a segment is rejected', () => {
  rejected(' notes/plan.md');
  rejected('notes /plan.md');
  rejected('notes/ plan.md');
  rejected('notes/plan.md ');
  rejected('notes/\u00a0plan.md');
  rejected('notes/plan.md\u00a0');
  rejected('notes/ /plan.md');
  rejected(' .md');
  // White space inside a name stays valid.
  assert.equal(accepted('notes/my plan.md'), 'notes/my plan.md');
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
  // The exported bounds are the ones that the rule holds, for the import.
  assert.equal(maxSegmentBytes, 255);
  const folders = `${'b'.repeat(maxSegmentBytes - 1)}/`.repeat(4);
  assert.equal(accepted(`${folders}c.md`).length, maxPathBytes);
  rejected(`${folders}cc.md`);
});

await test('a typed folder takes its stored spelling', () => {
  assert.equal(cleanFolderPath(' Journal/ '), 'Journal');
  assert.equal(cleanFolderPath('/Work/Days/'), 'Work/Days');
  assert.equal(cleanFolderPath('  '), '');
  assert.equal(cleanFolderPath('/'), '');
});

await test('a stored folder is a folder path in its normalized spelling', () => {
  assert.equal(isStoredFolderPath('Templates'), true);
  assert.equal(isStoredFolderPath('Work/Templates'), true);
  assert.equal(isStoredFolderPath(''), false);
  assert.equal(isStoredFolderPath('/Templates'), false);
  assert.equal(isStoredFolderPath('Work//Templates'), false);
  assert.equal(isStoredFolderPath('Templates '), false);
  // The decomposed spelling is a folder, but not in its stored spelling.
  assert.equal(isStoredFolderPath('Cafe\u0301'), false);
  assert.equal(isStoredFolderPath('Caf\u00e9'), true);
});

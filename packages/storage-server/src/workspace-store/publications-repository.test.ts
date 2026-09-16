/**
 * The shape of the reader path repository.
 *
 * Decision 0030 states that the scope of a link lives in the SQL of this
 * repository, so no caller can forget it. A comment cannot hold that, and a
 * database test proves one query at a time. This test holds the shape of the
 * whole file instead: it reads the source and refuses a second query over the
 * note table.
 *
 * A later author who adds a read of a note therefore has two choices: narrow
 * the one scoped query, which keeps the bound, or write a second query and
 * fail this test with the reason for the rule.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./publications-repository.ts', import.meta.url),
  'utf8',
);

/** How many times `needle` is in the source of the repository. */
function occurrences(needle: string): number {
  return source.split(needle).length - 1;
}

await test('one query of this file answers a note', () => {
  assert.equal(
    occurrences('.from(files)'),
    2,
    'The repository reads the file table for a note and for an attachment, and nowhere else.',
  );
  assert.equal(
    occurrences("eq(files.kind, 'note')"),
    1,
    'One query answers a note, and it is the one that binds the scope.',
  );
  assert.equal(
    occurrences('scopeBound(open)'),
    1,
    'The scope bound belongs to the one query that answers a note.',
  );
});

await test('every query binds the workspace of the opened link', () => {
  assert.equal(
    occurrences('eq(files.workspaceId, open.link.workspaceId)'),
    occurrences('.from(files)'),
    'A query over the file table names the workspace of the link that this transaction opened.',
  );
});

await test('the scope bound is read from the opened record only', () => {
  assert.equal(
    occurrences('requireOpen(link)'),
    4,
    'Every method after the lookup reads the record that this transaction opened.',
  );
  assert.equal(
    occurrences('opened.set('),
    1,
    'The digest lookup is the one place that opens a link.',
  );
});

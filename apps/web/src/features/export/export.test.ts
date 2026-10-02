import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadName,
  importRefusalMessage,
  transferFailureMessage,
} from './export.ts';

await test('the download name comes from the encoded form of the header', () => {
  assert.equal(
    downloadName(
      `attachment; filename="Gr__e.md"; filename*=UTF-8''Gr%C3%BC%C3%9Fe.md`,
      'note.md',
    ),
    'Grüße.md',
  );
});

await test('the quoted form is used when no encoded form is there', () => {
  assert.equal(
    downloadName('attachment; filename="plan.md"', 'note.md'),
    'plan.md',
  );
});

await test('a missing or unreadable header falls back to the given name', () => {
  assert.equal(downloadName(null, 'note.md'), 'note.md');
  assert.equal(downloadName('attachment', 'notes.zip'), 'notes.zip');
  assert.equal(
    downloadName(`attachment; filename*=UTF-8''%E0%A4%A`, 'note.md'),
    'note.md',
  );
});

await test('each refusal of an import names its cause and the next step', () => {
  // Issue 243. An archive of more files than the import took read as a
  // content failure, and the person read a general sentence.
  assert.equal(
    importRefusalMessage({ code: 'archive_too_many_files' }),
    'The zip file has more than 65535 files. Put the files in smaller zip files and import each one.',
  );
  assert.equal(
    importRefusalMessage({ code: 'archive_too_large' }),
    'The files in the zip file are larger than 100 MiB. Put the files in smaller zip files and import each one.',
  );
  assert.equal(
    importRefusalMessage({ code: 'archive_invalid' }),
    'This file is not a zip file that NotesApp can read. Make the zip file again and import it.',
  );
  const messages = [
    'path_conflict',
    'unauthenticated',
    'payload_too_large',
    'archive_too_many_files',
    'archive_too_large',
    'archive_invalid',
    'unsupported_media_type',
    'quota_exceeded',
  ].map((code) => importRefusalMessage({ code }));
  assert.equal(
    new Set(messages).size,
    messages.length,
    'one cause, one message',
  );
  for (const message of messages)
    assert.doesNotMatch(message, /[\u2013\u2014]|_/);
});

await test('an unknown refusal of an import gets the general sentence', () => {
  assert.equal(
    importRefusalMessage({ code: 'internal_error' }),
    'The import did not finish. Check the zip file and try again.',
  );
  assert.equal(
    importRefusalMessage(null),
    'The import did not finish. Check the zip file and try again.',
  );
});

await test('a screen shows the sentence of a refused transfer', () => {
  // Issue 243. The screen read the general problem text, which names a lost
  // connection for an error that carries no problem code.
  assert.equal(
    transferFailureMessage(
      new Error(importRefusalMessage({ code: 'archive_invalid' })),
    ),
    'This file is not a zip file that NotesApp can read. Make the zip file again and import it.',
  );
  assert.equal(
    transferFailureMessage({ code: 'internal_error' }),
    'The request did not finish. Try again.',
  );
});

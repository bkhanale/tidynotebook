/** The sentence of an import (record 0172). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { importResultSentence } from './import-result.ts';

await test('an import counts what came in', () => {
  assert.equal(
    importResultSentence({
      notes: 1,
      attachments: 3,
      skipped: { files: 0, kinds: [] },
    }),
    'Imported 1 note and 3 images.',
  );
});

await test('an import names the files that it left out', () => {
  // Review of record 0172: a vault with a canvas or a PDF failed whole, and
  // the settings of the tool went out in silence.
  assert.equal(
    importResultSentence({
      notes: 2,
      attachments: 1,
      skipped: { files: 4, kinds: ['canvas', 'file', 'pdf', 'settings'] },
    }),
    'Imported 2 notes and 1 image. Left out 4 files that a note cannot hold: .canvas, files with no type, .pdf, settings of an app.',
  );
  assert.equal(
    importResultSentence({
      notes: 0,
      attachments: 0,
      skipped: { files: 1, kinds: ['pdf'] },
    }),
    'Imported 0 notes and 0 images. Left out 1 file that a note cannot hold: .pdf.',
  );
});

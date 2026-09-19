import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changelogEntries,
  changelogEntry,
  releaseNotes,
  unwrap,
} from './release-notes.mjs';

const changelog = `# Changelog

All notable changes to this project are recorded here.

## 0.3.3 - 2026-09-19

This patch release simplifies the Trash delete flow and keeps the Publish
action quiet at rest.

### Changed

- Trash uses Delete for the remove action. The page states that Delete removes
  a note for good.
- The Publish action stays quiet at rest.

## 0.3.2 - 2026-09-18

This patch release renders the same Markdown everywhere.

### Fixed

- A soft line break joins one paragraph.
`;

await test('the entries are read newest first, with the version and the date', () => {
  const entries = changelogEntries(changelog);
  assert.deepEqual(
    entries.map((entry) => `${entry.version} ${entry.date}`),
    ['0.3.3 2026-09-19', '0.3.2 2026-09-18'],
  );
});

await test('an entry of an unknown version is absent', () => {
  assert.equal(changelogEntry(changelog, '9.9.9'), null);
  assert.equal(releaseNotes(changelog, '9.9.9'), null);
});

await test('the notes join each wrapped line and keep the sections', () => {
  assert.equal(
    releaseNotes(changelog, '0.3.3'),
    [
      'This patch release simplifies the Trash delete flow and keeps the Publish action quiet at rest.',
      '',
      '### Changed',
      '',
      '- Trash uses Delete for the remove action. The page states that Delete removes a note for good.',
      '- The Publish action stays quiet at rest.',
      '',
    ].join('\n'),
  );
});

await test('the notes hold no heading of the entry itself', () => {
  assert.equal(
    releaseNotes(changelog, '0.3.2')?.startsWith('This patch'),
    true,
  );
});

await test('a fenced block keeps its own lines', () => {
  assert.equal(
    unwrap('Run it:\n\n```sh\ndocker compose up -d\ndocker compose ps\n```\n'),
    'Run it:\n\n```sh\ndocker compose up -d\ndocker compose ps\n```\n',
  );
});

await test('two blank lines between blocks become one', () => {
  assert.equal(
    unwrap('One\nline.\n\n\n\nAnother.\n'),
    'One line.\n\nAnother.\n',
  );
});

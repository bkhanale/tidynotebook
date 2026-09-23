import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceFileSummary } from '@notesapp/api-client';
import type { LocalFileSummary } from '@notesapp/sync';
import { mergeFileSummaries } from './local-state.ts';

const remote: WorkspaceFileSummary = {
  fileId: 'file-a',
  path: 'old.md',
  kind: 'note',
  headRevisionId: 'revision-a',
  createdAt: '2026-09-06T10:00:00.000Z',
  updatedAt: '2026-09-07T10:00:00.000Z',
};

function local(extra: Partial<LocalFileSummary> = {}): LocalFileSummary {
  return {
    fileId: 'file-a',
    path: 'old.md',
    kind: 'note',
    deleted: false,
    updatedAt: '2026-09-07T10:01:00.000Z',
    acceptedHeadRevisionId: 'revision-a',
    localHeadRevisionId: 'revision-a',
    localOnly: false,
    ...extra,
  };
}

await test('local file state adds, renames, and deletes navigation entries', () => {
  assert.deepEqual(mergeFileSummaries([remote], [local()]), [remote]);
  assert.equal(
    mergeFileSummaries(
      [remote],
      [local({ path: 'renamed.md', localHeadRevisionId: 'revision-b' })],
    )[0]?.path,
    'renamed.md',
  );
  assert.deepEqual(
    mergeFileSummaries([remote], [local({ deleted: true })]),
    [],
  );
  assert.equal(
    mergeFileSummaries(
      [],
      [
        local({
          fileId: 'file-new',
          path: 'new.md',
          acceptedHeadRevisionId: null,
          localHeadRevisionId: null,
          localOnly: true,
        }),
      ],
    )[0]?.path,
    'new.md',
  );
});

await test('a merged entry keeps the created instant of the server', () => {
  assert.equal(
    mergeFileSummaries([remote], [local()])[0]?.createdAt,
    remote.createdAt,
  );
  assert.equal(
    mergeFileSummaries(
      [],
      [
        local({
          fileId: 'file-new',
          path: 'new.md',
          acceptedHeadRevisionId: null,
          localHeadRevisionId: null,
          localOnly: true,
        }),
      ],
    )[0]?.createdAt,
    '2026-09-07T10:01:00.000Z',
  );
});

await test('newer accepted local metadata wins over a stale remote listing', () => {
  assert.equal(
    mergeFileSummaries(
      [remote],
      [
        local({
          path: 'accepted-rename.md',
          acceptedHeadRevisionId: 'revision-b',
          localHeadRevisionId: 'revision-b',
        }),
      ],
    )[0]?.path,
    'accepted-rename.md',
  );
  assert.equal(
    mergeFileSummaries(
      [
        {
          ...remote,
          path: 'remote-rename.md',
          updatedAt: '2026-09-07T10:02:00.000Z',
        },
      ],
      [local()],
    )[0]?.path,
    'remote-rename.md',
  );
});

await test('a note keeps the instant it was saved, not the instant it arrived', () => {
  // A snapshot writes every note of this device at one instant. The listing
  // names the same revision and states when it was saved, so every note read
  // "just now" after each snapshot until this rule.
  const arrived = local({ updatedAt: '2026-09-23T07:08:27.295Z' });
  assert.equal(
    mergeFileSummaries([remote], [arrived])[0]?.updatedAt,
    remote.updatedAt,
  );
  // Unsent work of this device is newer than the listing, so its instant
  // stays.
  assert.equal(
    mergeFileSummaries(
      [remote],
      [local({ ...arrived, localHeadRevisionId: 'revision-b' })],
    )[0]?.updatedAt,
    '2026-09-23T07:08:27.295Z',
  );
});

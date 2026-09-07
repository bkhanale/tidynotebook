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
  assert.deepEqual(mergeFileSummaries([remote], [local({ deleted: true })]), []);
  assert.equal(
    mergeFileSummaries([], [
      local({
        fileId: 'file-new',
        path: 'new.md',
        acceptedHeadRevisionId: null,
        localHeadRevisionId: null,
        localOnly: true,
      }),
    ])[0]?.path,
    'new.md',
  );
});

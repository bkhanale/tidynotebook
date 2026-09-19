import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../..');

await test('the built note name asks for no saved personal data', async () => {
  const [source, module] = await Promise.all([
    readFile(
      resolve(root, 'apps/web/dist/features/editor/note-header.js'),
      'utf8',
    ),
    import('../../apps/web/dist/lib/note-name-input.js'),
  ]);
  assert.match(source, /\.\.\.noteNameInputPolicy\(\)/);
  assert.deepEqual(module.noteNameInputPolicy(), {
    autoComplete: 'off',
  });
});

await test('the built Publish header action is quiet at rest', async () => {
  const [source, style] = await Promise.all([
    readFile(
      resolve(root, 'apps/web/dist/features/editor/note-header-actions.js'),
      'utf8',
    ),
    import('../../apps/web/dist/features/editor/note-header-action-style.js'),
  ]);
  assert.match(source, /variant: noteHeaderPublishButtonVariant/);
  assert.equal(style.noteHeaderPublishButtonVariant, 'ghost');
});

await test('the built loader rejects state from another note', async () => {
  const module = await import('../../apps/web/dist/lib/note-load-state.js');
  const status = module.noteLoadStatusFor(
    {
      identity: {
        accountId: 'account-one',
        workspaceId: 'workspace-one',
        fileId: 'deleted-note',
      },
      status: {
        kind: 'ready',
        path: 'Deleted folder/Old name.md',
        text: 'old text',
        headRevisionId: 'old-revision',
        sequence: 4,
      },
    },
    {
      accountId: 'account-one',
      workspaceId: 'workspace-one',
      fileId: 'new-note',
    },
  );
  assert.deepEqual(status, { kind: 'loading' });
});

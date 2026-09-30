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

await test('the built note name is the last part of the breadcrumb', async () => {
  // Decision 0069. The name field renders into the breadcrumb slot of the
  // frame and reads the one class recipe of that field, so the note surface
  // below it states the name nowhere.
  const source = await readFile(
    resolve(root, 'apps/web/dist/features/editor/note-header.js'),
    'utf8',
  );
  assert.match(source, /HeaderLeaf/);
  assert.match(source, /noteNameFieldClassName\(\)/);
});

await test('the built note route puts History and Publish in one menu', async () => {
  // Decision 0069. The header carries the note menu and nothing else of the
  // route, so neither History nor Publish keeps a control of its own.
  const [source, menu] = await Promise.all([
    readFile(
      resolve(root, 'apps/web/dist/features/editor/note-header-actions.js'),
      'utf8',
    ),
    import('../../apps/web/dist/lib/note-menu.js'),
  ]);
  const ids = menu
    .noteMenuRows({ canMove: true, canPublish: true })
    .map((row) => row.id);
  assert.ok(ids.includes('history'));
  assert.ok(ids.includes('publish'));
  assert.match(source, /noteMenuRows/);
  assert.ok(!source.includes('HistoryIcon'));
  assert.ok(!source.includes('LinkIcon'));
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
    null,
  );
  assert.deepEqual(status, { kind: 'loading' });
});

await test('the built note screen opens a held note in one commit', async () => {
  // Switching notes showed the loading state, an editor with no text, and the
  // name twice in the header. The built loader suspends on the one open read
  // of the device, the built editor creates its view before paint, and the
  // built header claims the name before paint.
  const [loader, editor, header, state] = await Promise.all([
    readFile(
      resolve(root, 'apps/web/dist/features/editor/note-loader.js'),
      'utf8',
    ),
    readFile(
      resolve(root, 'apps/web/dist/features/editor/note-editor.js'),
      'utf8',
    ),
    readFile(resolve(root, 'apps/web/dist/shell/header-slot.js'), 'utf8'),
    import('../../apps/web/dist/lib/note-load-state.js'),
  ]);
  assert.match(loader, /use\(deviceOpens\.open\(store, identity\)\.held\)/);
  assert.match(loader, /deviceOpens\.forget\(store\)/);
  assert.match(
    editor,
    /useLayoutEffect\(\(\) => \{\s*const container = containerRef\.current;/,
  );
  assert.match(
    header,
    /useLayoutEffect\(\(\) => claimLeaf\(\), \[claimLeaf\]\)/,
  );
  const held = {
    kind: 'ready' as const,
    path: 'Next note.md',
    text: 'next text',
    headRevisionId: 'next-revision',
    sequence: 0,
  };
  const status = state.noteLoadStatusFor(
    {
      identity: { accountId: 'a', workspaceId: 'w', fileId: 'last-note' },
      status: { kind: 'deleted', path: 'Last note.md' },
    },
    { accountId: 'a', workspaceId: 'w', fileId: 'next-note' },
    held,
  );
  assert.equal(status, held);
});

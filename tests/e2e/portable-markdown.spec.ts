import { Buffer } from 'node:buffer';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPalette,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

/** One stored ZIP entry at `imported/friend.md`. */
const portableArchive = Buffer.from(
  'UEsDBBQAAAgAAAAAIVyNl+X+CQAAAAkAAAASAAAAaW1wb3J0ZWQvZnJpZW5kLm1kIyBGcmllbmQKUEsBAhQAFAAACAAAAAAhXI2X5f4JAAAACQAAABIAAAAAAAAAAAAAAAAAAAAAAGltcG9ydGVkL2ZyaWVuZC5tZFBLBQYAAAAAAQABAEAAAAA5AAAAAAA=',
  'base64',
);

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('an imported relative link appears as a backlink', async ({
  checkedPage: page,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone-390' ||
      testInfo.project.name === 'tablet-768',
    'Desktop engines cover the portable workspace journey.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  const sourceName = `portable-source-${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(sourceName);
  await replaceEditorText(page, '[Friend](imported/friend.md)\n');
  await waitForServerSave(page);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import workspace' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'portable.zip',
    mimeType: 'application/zip',
    buffer: portableArchive,
  });
  await expect(page.getByText('Imported 1 note and 0 images.')).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  const palette = await openPalette(page);
  await palette.getByLabel('Search notes, or type an action').fill('friend');
  await palette.getByRole('option', { name: /friend/i }).click();
  const backlinks = page.getByRole('region', { name: 'Links to this note' });
  await expect(backlinks.getByRole('link', { name: sourceName })).toBeVisible();
});

test('a note lists its inbound links with no connection', async ({
  checkedPage: page,
  context,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone-390' ||
      testInfo.project.name === 'tablet-768',
    'The note aside opens above the large breakpoint only.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const stamp = Date.now().toString();
  const targetName = `offline-target-${stamp}`;
  const sourceName = `offline-source-${stamp}`;

  await createNewNote(page);
  await page.getByLabel('Note name').fill(targetName);
  await replaceEditorText(page, '# Target\n');
  await waitForServerSave(page);

  await createNewNote(page);
  await page.getByLabel('Note name').fill(sourceName);
  await replaceEditorText(page, `[Target](${targetName}.md)\n`);
  await waitForServerSave(page);

  // The device holds both bodies now, so the panel has to answer without the
  // server. The move to the target note stays inside the open application.
  await context.setOffline(true);
  const palette = await openPalette(page);
  await palette.getByLabel('Search notes, or type an action').fill(targetName);
  await palette.getByRole('option', { name: targetName }).click();
  await expect(page.getByLabel('Note name')).toHaveValue(targetName);

  const backlinks = page.getByRole('region', { name: 'Links to this note' });
  await expect(backlinks.getByRole('link', { name: sourceName })).toBeVisible();
  await expect(
    backlinks.getByText('These links come from this device.'),
  ).toBeVisible();
});

import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPersonalWorkspace,
  replaceEditorText,
  runNoteAction,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('a note restored from the trash keeps its text', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `restore-${Date.now().toString()}`;
  const body = '# Keep me\n\nThe text survives the round trip.';
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, body);
  await waitForServerSave(page);

  // Delete the open note through the command palette, then open the trash.
  await runNoteAction(page, 'Delete this note');
  await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();
  await runNoteAction(page, 'Go to Trash');
  await expect(
    page.getByRole('heading', { name: 'Trash', level: 1 }),
  ).toBeVisible();

  const row = page.locator('li').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  // The row names the note it restores, so two rows of the list are told
  // apart by name alone.
  await row.getByRole('button', { name: `Restore ${name}` }).click();

  // Restore writes a new version and returns to the note. The text is there
  // again, and it stays after a reload because the server accepted it.
  await expect(page.locator('.cm-content')).toContainText(
    'The text survives the round trip.',
  );
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText(
    'The text survives the round trip.',
  );

  // The trash no longer holds the note. Scope to the main area, because the
  // sidebar now lists the restored note.
  await runNoteAction(page, 'Go to Trash');
  await expect(
    page.locator('main').locator('li').filter({ hasText: name }),
  ).toHaveCount(0);
});

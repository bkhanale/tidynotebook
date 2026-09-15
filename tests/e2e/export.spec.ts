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

test('a note leaves as a file that keeps its name', async ({
  checkedPage: page,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone-390' ||
      testInfo.project.name === 'tablet-768',
    'Desktop engines cover the download journey.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  // The name holds a character outside ASCII and an apostrophe. Neither one
  // can travel unencoded in the header that names the download, so this
  // journey proves the whole chain: the name of the note, the header, and the
  // name that the browser offers the person.
  const name = `Grüße it's ${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# The plan\n\nOne line of it.\n');
  await waitForServerSave(page);

  const download = page.waitForEvent('download');
  await runNoteAction(page, 'Export this note as Markdown');
  // The suffix is a storage detail that the note name hides, and a saved file
  // needs it, so the download carries it and the name field never shows it.
  expect((await download).suggestedFilename()).toBe(`${name}.md`);
});

import { Buffer } from 'node:buffer';
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

/** A small valid PNG, so the server accepts it as an image. */
const pixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4ISf3HxkzkC4AAEG4IDHG8wOiAAAAAElFTkSuQmCC',
  'base64',
);

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('an attached image travels to the server and back', async ({
  checkedPage: page,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone-390' ||
      testInfo.project.name === 'tablet-768',
    'Desktop engines cover the attachment journey.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = `attachment-${Date.now().toString()}`;
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# With an image\n\n');
  // Leave the caret on the empty line after the heading, so the attachment
  // lands on a line of its own.
  await page.locator('.cm-content').press('Control+End');
  await waitForServerSave(page);

  const chooser = page.waitForEvent('filechooser');
  await runNoteAction(page, 'Attach an image to this note');
  await (
    await chooser
  ).setFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: pixelPng,
  });

  // While the caret sits on the inserted reference it shows as source. Move
  // it away so the one surface draws the image widget.
  await expect(page.locator('.cm-content')).toContainText('/attachments/');
  await page.locator('.cm-content').press('Control+Home');
  const image = page.locator('img.cm-np-widget-image');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /^blob:/);
  await waitForServerSave(page);

  // A reload reads the note and the attachment from the server.
  await page.reload();
  await expect(page.locator('img.cm-np-widget-image')).toBeVisible();
  await expect(page.locator('img.cm-np-widget-image')).toHaveAttribute(
    'src',
    /^blob:/,
  );
});

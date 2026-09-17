/**
 * The published link, from the command that makes one to the page that a
 * stranger reads.
 *
 * Plan 007 items 40 and 41. The owner publishes through the command palette
 * and through the folder row menu, and the reader opens the address in a
 * browser context of its own that holds no session and no cookie of this
 * product. That second context is the point of the file: the reader path of
 * decision 0031 is a closed boundary, and a journey that read the page with
 * the session of the owner would prove nothing about it.
 *
 * The reader opens the address with a plain navigation, because a published
 * page is a document that a person opens in a browser and no generated
 * operation of the client is involved in reading it.
 *
 * Every note and every folder of this file carries a name of its own, so the
 * journeys never meet the notes of another file in a parallel worker. See
 * [decision 0036](../../docs/decisions/0036-the-browser-gate-runs-in-parallel-workers.md).
 */
import { Buffer } from 'node:buffer';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openNavigation,
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

/** A name that no other journey and no other worker can hold. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Makes one folder through the real dialog. */
async function createFolder(page: Page, folder: string): Promise<void> {
  await openNavigation(page);
  await page
    .getByRole('button', { name: 'New folder', exact: true })
    .first()
    .click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Make folder' }).click();
  await expect(
    page.getByRole('button', { name: folder, exact: true }),
  ).toBeVisible();
}

/** Makes one note inside a folder through the folder row menu. */
async function createNoteInFolder(
  page: Page,
  folder: string,
  noteName: string,
  body: string,
): Promise<void> {
  await openNavigation(page);
  await page
    .getByRole('button', { name: `Actions for the folder ${folder}` })
    .click();
  await page.getByRole('menuitem', { name: 'New note in this folder' }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);
  const nameInput = page.getByLabel('Note name');
  await expect(nameInput).toBeFocused();
  await nameInput.fill(noteName);
  await replaceEditorText(page, body);
  await waitForServerSave(page);
}

/** The address that the dialog shows one time, with its focus proved. */
async function readTheOneTimeLink(dialog: Locator): Promise<string> {
  const field = dialog.getByLabel('Link');
  await expect(field).toBeVisible();
  // The control that the person pressed has just left the screen, so the
  // keyboard has to stand on the one value that this moment hands over.
  await expect(field).toBeFocused();
  const address = await field.inputValue();
  const selected = await field.evaluate((node) =>
    node instanceof HTMLInputElement
      ? node.value.slice(node.selectionStart ?? 0, node.selectionEnd ?? 0)
      : '',
  );
  expect(selected).toBe(address);
  expect(address).not.toBe('');
  return address;
}

/**
 * Closes the publish dialog through the guard that the dialog raises.
 *
 * Nothing was copied, so the first press asks and the second answers. The
 * guard has its own journey below; this helper only gets past it.
 */
async function closeAfterPublish(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog.getByText('You did not copy this link.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close anyway' }).click();
  // The dialog is named, because a narrow viewport keeps the navigation
  // drawer open behind it and a drawer is a dialog as well.
  await expect(dialog).toHaveCount(0);
}

/** Publishes the open note and answers the address of its link. */
async function publishOpenNote(page: Page): Promise<string> {
  await runNoteAction(page, 'Publish this note');
  const dialog = page.getByRole('dialog', { name: 'Publish this note' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('This link opens one note.', { exact: false }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const address = await readTheOneTimeLink(dialog);
  await closeAfterPublish(dialog);
  return address;
}

/** A browser that never signed in, as a person with no account has. */
async function readerPageOf(
  context: BrowserContext,
  address: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(address);
  return page;
}

test('a reader with no session reads a published note', async ({
  browser,
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);

  const name = unique('published-note');
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(
    page,
    [
      '# The published heading',
      '',
      '- [x] packed',
      '- [ ] left',
      '',
      '| Item | Count |',
      '| ---- | ----: |',
      '| Tent | 2     |',
      '',
      '```ts',
      'const published = true;',
      '```',
      '',
    ].join('\n'),
  );
  await waitForServerSave(page);

  // One picture, so the reader proves the attachment address of the page as
  // well as its text. The caret sits at the end of the note after the fill.
  //
  // The finalize answer is the edge that this journey waits on. The save
  // state was already `saved-server` from the text above, so a wait on that
  // state alone could read the result of the earlier save and publish before
  // the picture was a revision. The reader then received a page with no
  // picture in it, which is what happened once on webkit under load.
  const finalized = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/finalize'),
  );
  const chooser = page.waitForEvent('filechooser');
  await runNoteAction(page, 'Attach an image to this note');
  await (
    await chooser
  ).setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: pixelPng });
  await expect(page.locator('.cm-content')).toContainText('attachments/');
  expect((await finalized).ok()).toBe(true);
  await waitForServerSave(page);

  const address = await publishOpenNote(page);
  expect(address.startsWith(`${stack.baseUrl}/published/`)).toBe(true);

  const readerContext = await browser.newContext();
  try {
    const reader = await readerPageOf(readerContext, address);
    // The heading, the task, the table and the code of the note, as the one
    // sanitized renderer wrote them on the server.
    await expect(
      reader.getByRole('heading', { name: 'The published heading' }),
    ).toBeVisible();
    await expect(
      reader.locator('input[type="checkbox"]').first(),
    ).toBeChecked();
    await expect(reader.locator('table')).toContainText('Tent');
    await expect(reader.locator('pre')).toContainText(
      'const published = true;',
    );
    // The picture travels through the address of the reader path, and the
    // browser decoded real bytes from the server.
    const picture = reader.locator('article img');
    await expect(picture).toBeVisible();
    const width = await picture.evaluate((node) =>
      node instanceof HTMLImageElement ? node.naturalWidth : 0,
    );
    expect(width).toBeGreaterThan(0);
    // This browser holds no cookie of the product, so the page it read is the
    // page that a person with no account receives.
    expect(await readerContext.cookies()).toEqual([]);
    // The page is a document that the server wrote, not the application.
    expect(await reader.locator('#root').count()).toBe(0);
    await expect(reader.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  } finally {
    await readerContext.close();
  }
});

test('the link is shown one time and never again', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  const name = unique('published-once');
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# Shown one time');
  await waitForServerSave(page);

  const address = await publishOpenNote(page);
  const token = address.slice(address.lastIndexOf('/') + 1);
  expect(token.length).toBeGreaterThan(20);

  // The dialog opens again and starts at its first state, with no link in it.
  await runNoteAction(page, 'Publish this note');
  const dialog = page.getByRole('dialog', { name: 'Publish this note' });
  await expect(dialog.getByLabel('Link')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // No screen of the application holds that token again, including the list
  // that names every link of the workspace.
  expect(await page.content()).not.toContain(token);
  await openNavigation(page);
  await page.getByRole('link', { name: 'Published links' }).click();
  const links = page.getByRole('region', { name: 'Your links' });
  await expect(links.getByText(name)).toBeVisible();
  expect(await page.content()).not.toContain(token);
});

test('the dialog asks once before the one time link leaves the screen', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  const name = unique('published-guard');
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# The guard');
  await waitForServerSave(page);

  await runNoteAction(page, 'Publish this note');
  const dialog = page.getByRole('dialog', { name: 'Publish this note' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await readTheOneTimeLink(dialog);

  const question = dialog.getByText('You did not copy this link.');
  // Escape asks, and Escape again answers.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(question).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a press on the scrim asks the same question', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  const name = unique('published-scrim');
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# The scrim');
  await waitForServerSave(page);

  await runNoteAction(page, 'Publish this note');
  const dialog = page.getByRole('dialog', { name: 'Publish this note' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await readTheOneTimeLink(dialog);

  const scrim = page.locator('[data-notes-dialog-root]');
  await scrim.click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('You did not copy this link.')).toBeVisible();
  await scrim.click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
});

test('the dialog works where the browser has no clipboard', async ({
  browserName,
  checkedPage: page,
  stack,
}) => {
  // Only the Chromium engines refuse `clipboard.writeText` without a granted
  // permission. Firefox and WebKit answer it on a user gesture, so the
  // sentence under test cannot appear there, and this journey would assert
  // nothing on those engines.
  test.skip(
    browserName !== 'chromium',
    'Only Chromium denies the clipboard by default.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  const name = unique('published-clipboard');
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, '# No clipboard');
  await waitForServerSave(page);

  await runNoteAction(page, 'Publish this note');
  const dialog = page.getByRole('dialog', { name: 'Publish this note' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const address = await readTheOneTimeLink(dialog);

  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(
    dialog.getByText('Copying is not available here.'),
  ).toBeVisible();
  // The link stays on the screen in a field that a keyboard reaches, and the
  // guard is still armed, because nothing was copied.
  expect(await dialog.getByLabel('Link').inputValue()).toBe(address);
  await page.keyboard.press('Escape');
  await expect(dialog.getByText('You did not copy this link.')).toBeVisible();
});

test('a folder link opens every note below the folder', async ({
  browser,
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);

  // The folder that gets the link sits inside the folder that keeps the
  // private note, because the tree selects the folder of the note that was
  // opened last. The private note is therefore one step above the scope, and
  // the link must not reach it.
  const outside = unique('private');
  const folder = unique('trip');
  const dayOne = 'day-one';
  const dayTwo = 'day-two';
  const secret = 'salary';
  await createFolder(page, outside);
  await createNoteInFolder(
    page,
    outside,
    secret,
    '# Pay\n\nThe private words.',
  );
  await createFolder(page, folder);
  await createNoteInFolder(
    page,
    folder,
    dayTwo,
    '# Day two\n\nThe second day.',
  );
  await createNoteInFolder(
    page,
    folder,
    dayOne,
    [
      '# Day one',
      '',
      'The first day.',
      '',
      `[The second day](${dayTwo}.md)`,
      '',
      `[The salary](../${secret}.md)`,
      '',
    ].join('\n'),
  );

  await openNavigation(page);
  await page
    .getByRole('button', { name: `Actions for the folder ${folder}` })
    .click();
  await page.getByRole('menuitem', { name: 'Publish folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish this folder' });
  // The reach of a folder link is stated before the person confirms it.
  await expect(
    dialog.getByText('This link lists the name of every note in this folder.'),
  ).toBeVisible();
  await expect(dialog.getByText('It opens 2 notes now.')).toBeVisible();
  await expect(
    dialog.getByText(
      'It also opens every note that you add to this folder later.',
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const address = await readTheOneTimeLink(dialog);
  await closeAfterPublish(dialog);

  const readerContext = await browser.newContext();
  try {
    const reader = await readerPageOf(readerContext, address);
    // The list names every note of the folder and nothing outside it.
    await expect(reader.getByRole('heading', { name: 'Notes' })).toBeVisible();
    await expect(reader.getByRole('link', { name: dayOne })).toBeVisible();
    await expect(reader.getByRole('link', { name: dayTwo })).toBeVisible();
    await expect(reader.getByRole('link', { name: secret })).toHaveCount(0);
    // A stored path suffix never reaches a person.
    expect(await reader.locator('main').innerText()).not.toContain('.md');

    await reader.getByRole('link', { name: dayOne }).click();
    await expect(
      reader.getByRole('heading', { name: 'Day one' }),
    ).toBeVisible();
    // The link to the note in scope opens the second note of the same link.
    await reader.getByRole('link', { name: 'The second day' }).click();
    await expect(
      reader.getByRole('heading', { name: 'Day two' }),
    ).toBeVisible();
    await expect(reader.getByText('The second day.')).toBeVisible();

    // The link outside the scope keeps its words and holds no address, so the
    // page discloses no note and offers no sign-in screen.
    await reader.getByRole('link', { name: 'All notes' }).click();
    await reader.getByRole('link', { name: dayOne }).click();
    await expect(reader.getByText('The salary')).toBeVisible();
    await expect(reader.getByRole('link', { name: 'The salary' })).toHaveCount(
      0,
    );
    // Nothing of the folder above the scope reaches the page, so the words of
    // the link are all that is left of it.
    expect(await reader.locator('main').innerHTML()).not.toContain(outside);
    expect(await reader.locator('main').innerHTML()).not.toContain(
      'The private words.',
    );
    expect(await readerContext.cookies()).toEqual([]);

    // A note added later is served by the same link, as the dialog said.
    await createNoteInFolder(page, folder, 'day-three', '# Day three\n\nLate.');
    await reader.goto(address);
    await expect(reader.getByRole('link', { name: 'day-three' })).toBeVisible();
  } finally {
    await readerContext.close();
  }
});

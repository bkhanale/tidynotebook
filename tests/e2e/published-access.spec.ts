/**
 * What a published link opens, and when it stops opening it.
 *
 * Plan 007 items 42 and 43. The password, the expiry, the reading ticket and
 * Revoke are the four rules that decide whether the address of a reader still
 * answers a note, and every one of them is driven here through the screens of
 * the owner and the page of a reader with no session.
 *
 * **Nothing here waits.** A link with an expiry and a ticket with a life of
 * twelve hours cannot be aged by a delay, and `tests/AGENTS.md` refuses one.
 * The journeys ask the stack for the retention run that the hour after the
 * instant in question would perform, which is the product's own hourly job
 * with a cutoff of the journey. The life of a ticket comes from
 * `readingTicketLifetimeMs` of `@notesapp/core`, so the number in this file is
 * the number of the rule.
 *
 * **One sentence for one cause.** Record 0047 makes the page answer a page for
 * every state of a link, so a revoked link and an unknown token read alike,
 * and a wrong password returns the same form and the same words as a link that
 * nobody has opened yet.
 */
import { readingTicketLifetimeMs } from '@notesapp/core';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import type { E2EStack } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openNavigation,
  openPalette,
  openPersonalWorkspace,
  replaceEditorText,
  runNoteAction,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/** A name that no other journey and no other worker can hold. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** The words of the one sentence of a link that opens nothing. */
const unavailable = 'This link is not available.';

/** The words of a link that asks for a password. */
const locked = 'This link needs a password.';

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

/** Writes one note with a name of its own and waits for the server. */
async function writeNote(
  page: Page,
  name: string,
  body: string,
): Promise<void> {
  await createNewNote(page);
  await page.getByLabel('Note name').fill(name);
  await replaceEditorText(page, body);
  await waitForServerSave(page);
}

/** Opens the publish dialog of the open note. */
async function openPublishDialog(page: Page): Promise<Locator> {
  await runNoteAction(page, 'Publish this note');
  const dialog = page.getByRole('dialog', { name: 'Publish this note' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Reads the one time link and closes the dialog through its guard. */
async function takeTheLink(dialog: Locator): Promise<string> {
  const field = dialog.getByLabel('Link');
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  const address = await field.inputValue();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close anyway' }).click();
  await expect(dialog).toHaveCount(0);
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

/** Opens the list of published links from the command palette. */
async function openPublishedLinks(page: Page, stack: E2EStack): Promise<void> {
  const palette = await openPalette(page);
  await palette
    .getByLabel('Search notes, or type an action')
    .fill('Published links');
  await palette
    .getByRole('option', { name: 'Go to Published links', exact: true })
    .click();
  await page.waitForURL(`${stack.baseUrl}/w/*/published`);
  await expect(
    page.getByRole('heading', { name: 'Published links', level: 1 }),
  ).toBeVisible();
}

/** The row of one link on the list of the owner. */
function linkRow(page: Page, name: string): Locator {
  return page
    .getByRole('region', { name: 'Your links' })
    .getByRole('listitem')
    .filter({ hasText: name });
}

test('a password guards a published link', async ({
  browser,
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const name = unique('published-password');
  await writeNote(page, name, '# The locked note\n\nThe guarded words.');

  const dialog = await openPublishDialog(page);
  const password = dialog.getByLabel('Password', { exact: true });
  // A password under the one policy of the product never leaves the screen.
  await password.fill('too-short');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByText('This password is too short.')).toBeVisible();
  await expect(dialog.getByLabel('Link')).toHaveCount(0);

  await password.fill('a-strong-link-password');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const address = await takeTheLink(dialog);

  const readerContext = await browser.newContext();
  try {
    const reader = await readerPageOf(readerContext, address);
    await expect(reader.getByText(locked)).toBeVisible();
    await expect(reader.getByText('The guarded words.')).toHaveCount(0);
    const asked = await reader.locator('main').innerText();

    // A wrong password answers the same form and the same words, so the page
    // states nothing about the password and nothing about the link.
    await reader.getByLabel('Password').fill('not-the-password');
    await reader.getByRole('button', { name: 'Open' }).click();
    await expect(reader.getByText(locked)).toBeVisible();
    expect(await reader.locator('main').innerText()).toBe(asked);
    await expect(reader.getByText('The guarded words.')).toHaveCount(0);

    await reader.getByLabel('Password').fill('a-strong-link-password');
    await reader.getByRole('button', { name: 'Open' }).click();
    await expect(
      reader.getByRole('heading', { name: 'The locked note' }),
    ).toBeVisible();
    await expect(reader.getByText('The guarded words.')).toBeVisible();
    expect(await readerContext.cookies()).toEqual([]);

    // A token that never existed says the one sentence of a link that opens
    // nothing, which is the sentence of a revoked link and of an expired one.
    const unknown = await reader.goto(
      `${stack.baseUrl}/published/aaaaaaaaaaaaaaaaaaaaaaaa`,
    );
    expect(unknown?.status()).toBe(200);
    await expect(reader.getByText(unavailable)).toBeVisible();
  } finally {
    await readerContext.close();
  }
});

test('an expiry states when the link stops and the link stops', async ({
  browser,
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const name = unique('published-expiry');
  await writeNote(page, name, '# The short link\n\nThe words of a week.');

  const dialog = await openPublishDialog(page);
  await dialog.getByLabel('Expiry').selectOption({ label: 'In 7 days' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const address = await takeTheLink(dialog);

  await openPublishedLinks(page, stack);
  await expect(linkRow(page, name)).toContainText('Stops in 7 days');

  const readerContext = await browser.newContext();
  try {
    const reader = await readerPageOf(readerContext, address);
    await expect(reader.getByText('The words of a week.')).toBeVisible();

    // The hour after the link stops, the retention run takes the record away.
    // The refusal by the expiry itself is the rule of `resolve-link.ts` and
    // its unit tests; what this journey proves is that the reader loses the
    // page and reads the one sentence of every cause.
    await stack.runPublicationRetention(new Date(Date.now() + 8 * 86_400_000));
    const stopped = await reader.goto(address);
    expect(stopped?.status()).toBe(200);
    await expect(reader.getByText(unavailable)).toBeVisible();
    await expect(reader.getByText('The words of a week.')).toHaveCount(0);
  } finally {
    await readerContext.close();
  }
});

test('a reading ticket past its life asks for the password again', async ({
  browser,
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  // A folder link, because the reader of a folder link walks from the list to
  // a note, and the ticket of decision 0046 travels in the address of that
  // step. The page holds no script, so there is no other way to carry it.
  const folder = unique('ticket-folder');
  const noteName = 'the-ticket-note';
  await createFolder(page, folder);
  await createNoteInFolder(
    page,
    folder,
    noteName,
    '# The ticket note\n\nThe words behind a ticket.',
  );

  await openNavigation(page);
  await page
    .getByRole('button', { name: `Actions for the folder ${folder}` })
    .click();
  await page.getByRole('menuitem', { name: 'Publish folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish this folder' });
  await dialog
    .getByLabel('Password', { exact: true })
    .fill('another-strong-password');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const address = await takeTheLink(dialog);

  const readerContext = await browser.newContext();
  try {
    const reader = await readerPageOf(readerContext, address);
    await reader.getByLabel('Password').fill('another-strong-password');
    await reader.getByRole('button', { name: 'Open' }).click();
    await reader.getByRole('link', { name: noteName }).click();
    await expect(reader.getByText('The words behind a ticket.')).toBeVisible();
    const opened = reader.url();
    expect(opened).toContain('ticket=');
    // No cookie of the reader, before or after the unlock.
    expect(await readerContext.cookies()).toEqual([]);

    // A ticket lives twelve hours. The hour after that, the retention run
    // takes it away, and the address that carries it opens the form again.
    await stack.runPublicationRetention(
      new Date(Date.now() + readingTicketLifetimeMs + 3_600_000),
    );
    await reader.goto(opened);
    await expect(reader.getByText(locked)).toBeVisible();
    await expect(reader.getByText('The words behind a ticket.')).toHaveCount(0);

    // The same password opens it again, so the link itself is untouched.
    await reader.getByLabel('Password').fill('another-strong-password');
    await reader.getByRole('button', { name: 'Open' }).click();
    await expect(reader.getByText('The words behind a ticket.')).toBeVisible();
  } finally {
    await readerContext.close();
  }
});

test('Revoke stops the reader at once and empties the list', async ({
  browser,
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const name = unique('published-revoke');
  await writeNote(page, name, '# The revoked note\n\nThe words of a moment.');

  const dialog = await openPublishDialog(page);
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const address = await takeTheLink(dialog);

  const readerContext = await browser.newContext();
  try {
    const reader = await readerPageOf(readerContext, address);
    await expect(reader.getByText('The words of a moment.')).toBeVisible();

    await openPublishedLinks(page, stack);
    const row = linkRow(page, name);
    await expect(row).toBeVisible();
    // The list is an address of its own, so it survives a reload.
    await page.reload();
    await expect(linkRow(page, name)).toBeVisible();

    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(
      page.getByText(`The link to ${name} is revoked. It opens nothing now.`),
    ).toBeVisible();
    await expect(linkRow(page, name)).toHaveCount(0);

    // The record is read on every request, so the reader loses the note at
    // the next one. The address still answers a page, as record 0047 states.
    const revoked = await reader.goto(address);
    expect(revoked?.status()).toBe(200);
    await expect(reader.getByText(unavailable)).toBeVisible();
    await expect(reader.getByText('The words of a moment.')).toHaveCount(0);
  } finally {
    await readerContext.close();
  }

  // "Nothing is open" is the answer that an owner most needs to trust
  // (record 0048), so the screen has to reach it. Every link that this worker
  // published is revoked here, because the empty state is the state of a
  // workspace that holds no link at all.
  const rows = page.getByRole('region', { name: 'Your links' });
  for (;;) {
    const revoke = rows.getByRole('button', { name: 'Revoke' }).first();
    if ((await revoke.count()) === 0) break;
    await revoke.click();
    await expect(
      page.getByText('is revoked. It opens nothing now.'),
    ).toBeVisible();
  }
  // `EmptyState` writes its title as a paragraph, so the words are the match.
  await expect(page.getByText('No published links')).toBeVisible();
  await page.reload();
  await expect(page.getByText('No published links')).toBeVisible();
  // The screen stays in the sidebar while the workspace holds no link.
  await openNavigation(page);
  await expect(
    page.getByRole('link', { name: 'Published links' }),
  ).toBeVisible();
});

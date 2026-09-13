import { expect, type Locator, type Page } from '@playwright/test';
import type { E2EStack } from './stack.ts';

/** Opens the sign-in page and waits until its form can take input. */
async function openSignInForm(page: Page, loginUrl: string): Promise<void> {
  try {
    await page.goto(loginUrl, { waitUntil: 'commit', timeout: 15_000 });
  } catch {
    // Firefox can leave the navigation promise pending after the document
    // has rendered. The form wait below decides whether sign in can go on.
  }
  try {
    await page
      .getByLabel('Address')
      .waitFor({ state: 'visible', timeout: 15_000 });
    return;
  } catch {
    // The first document installs the service worker, and the worker then
    // claims the page. Firefox can hold the navigation open while that
    // happens. One reload reaches a page that the worker already controls.
  }
  try {
    await page.goto(loginUrl, { waitUntil: 'commit', timeout: 15_000 });
  } catch {
    // The same pending navigation is harmless; the form wait is the decider.
  }
  await page
    .getByLabel('Address')
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/** Signs in through the same form that a person uses. */
export async function signIn(page: Page, stack: E2EStack): Promise<void> {
  await openSignInForm(page, `${stack.baseUrl}/login`);
  await page.getByLabel('Address').fill(stack.email);
  await page.getByLabel('Password', { exact: true }).fill(stack.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]+$/);
}

/** Returns the personal workspace identifier opened by sign-in. */
export async function openPersonalWorkspace(page: Page): Promise<string> {
  await page.waitForURL(/\/w\/[0-9a-f-]+$/);
  const match = /\/w\/([0-9a-f-]+)$/.exec(new URL(page.url()).pathname);
  if (match?.[1] === undefined)
    throw new Error('The personal workspace URL has no identifier.');
  return match[1];
}

/** Creates a note through the visible action in the workspace sidebar. */
export async function createNewNote(page: Page): Promise<void> {
  const candidates = page.getByRole('button', {
    name: 'New note',
    exact: true,
  });
  // A narrow viewport keeps the sidebar in a closed drawer, so the action
  // stays hidden until the drawer opens. A wide viewport shows no drawer.
  const drawer = page.getByRole('button', { name: 'Open navigation' });
  try {
    await drawer.waitFor({ state: 'visible', timeout: 2_000 });
    await drawer.click();
  } catch {
    // No drawer on this viewport. The sidebar action is already placed.
  }
  await candidates.first().click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);
  // The new note focuses and selects its name, so a later fill lands on the
  // new note and never on the field of the note that was open before.
  await expect(page.getByLabel('Note name')).toBeFocused();
}

/** Replaces the CodeMirror source with normal browser input. */
export async function replaceEditorText(
  page: Page,
  text: string,
): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.press('Control+A');
  await editor.fill(text);
}

/** Waits for the active file status, not the workspace sync announcement. */
export async function waitForServerSave(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator('[data-save-state]').getAttribute('data-save-state'),
    )
    .toBe('saved-server');
}

/** Waits until the current edit changes the active file save state. */
export async function waitForLocalWrite(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator('[data-save-state]').getAttribute('data-save-state'),
    )
    .toBe('saved-local');
}

/** Opens the command palette from the header affordance. */
export async function openPalette(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /Search notes/ }).click();
  const palette = page.getByRole('dialog', {
    name: 'Search notes and run actions',
  });
  await expect(palette).toBeVisible();
  return palette;
}

/**
 * Runs one command palette action by its exact label.
 *
 * The palette is the only surface that carries a note action now, so a
 * journey reaches Save, Delete, History, and Attach through it.
 */
export async function runNoteAction(page: Page, label: string): Promise<void> {
  const palette = await openPalette(page);
  await palette.getByLabel('Search notes, or type an action').fill(label);
  await palette.getByRole('option', { name: label, exact: true }).click();
}

/** Opens the navigation drawer on a narrow viewport. */
export async function openNavigation(page: Page): Promise<void> {
  const drawer = page.getByRole('button', { name: 'Open navigation' });
  try {
    await drawer.waitFor({ state: 'visible', timeout: 2_000 });
    if ((await drawer.getAttribute('aria-expanded')) !== 'true')
      await drawer.click();
  } catch {
    // No drawer on this viewport. The sidebar is already placed.
  }
}

/** Closes the navigation drawer when one is open. */
export async function closeNavigation(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close navigation' });
  try {
    await close.waitFor({ state: 'visible', timeout: 2_000 });
    await close.click();
  } catch {
    // No drawer on this viewport. The sidebar never covers the header.
  }
}

/**
 * The control that expands or collapses one folder row.
 *
 * The folder name is a separate selection button, so the disclosure is the
 * icon control that carries `Expand folder` or `Collapse folder`.
 */
export function folderDisclosure(page: Page, folder: string): Locator {
  const escaped = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('button', {
    name: new RegExp(`(?:Expand|Collapse) folder ${escaped}`),
  });
}

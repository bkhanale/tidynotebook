import { expect, type Locator, type Page } from '@playwright/test';
import type { E2EStack } from './stack.ts';

/** The Tailwind medium breakpoint that changes the sidebar to a drawer. */
const navigationBreakpoint = 768;

/** Whether this configured viewport uses the navigation drawer. */
function hasNavigationDrawer(page: Page): boolean {
  const viewport = page.viewportSize();
  return viewport !== null && viewport.width < navigationBreakpoint;
}

/**
 * Opens one address and waits for the thing that says the screen is there.
 *
 * Firefox can leave the navigation promise pending after the document has
 * rendered, so a bare `goto` with the default wait has timed out at the full
 * journey budget of 120 seconds while the screen was on the display the whole
 * time. Every journey that opens an address of its own reaches it through
 * here: the navigation commits, the screen decides, and one retry covers a
 * first document that the browser is still finishing.
 */
export async function openAddress(
  page: Page,
  address: string,
  ready: () => Locator,
): Promise<void> {
  try {
    await page.goto(address, { waitUntil: 'commit', timeout: 15_000 });
  } catch {
    // The pending navigation is harmless; the wait below is the decider.
  }
  try {
    await ready().waitFor({ state: 'visible', timeout: 15_000 });
    return;
  } catch {
    // The screen did not appear on the first attempt. Firefox can hold a
    // first document open while the browser still has work of its own to
    // finish, so the journey asks once more rather than failing on it.
  }
  try {
    await page.goto(address, { waitUntil: 'commit', timeout: 15_000 });
  } catch {
    // The same pending navigation is harmless.
  }
  await ready().waitFor({ state: 'visible', timeout: 30_000 });
}

/** Opens the sign-in page and waits until its form can take input. */
export async function openSignInForm(
  page: Page,
  loginUrl: string,
): Promise<void> {
  await openAddress(page, loginUrl, () => page.getByLabel('Address'));
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
  if (hasNavigationDrawer(page)) {
    const drawer = page.getByRole('button', { name: 'Open navigation' });
    await expect(drawer).toBeVisible();
    if ((await drawer.getAttribute('aria-expanded')) !== 'true')
      await drawer.click();
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
  // Observe this edit before a caller waits for its server result. Without
  // this edge, a fast assertion can read the saved state of the prior edit.
  await expect
    .poll(() =>
      page.locator('[data-save-state]').getAttribute('data-save-state'),
    )
    .not.toBe('saved-server');
}

/** Waits for the active file status, not the workspace sync announcement. */
export async function waitForServerSave(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator('[data-save-state]').getAttribute('data-save-state'),
    )
    .toBe('saved-server');
}

/**
 * Closes the current version and waits until the server holds it.
 *
 * A version closes after a pause in typing, so two edits that follow each
 * other quickly become one version. Control + S is the visible accelerator
 * that closes a version at once, so a journey that needs two versions asks
 * for the boundary instead of waiting out the pause.
 */
export async function saveVersion(page: Page): Promise<void> {
  await page.keyboard.press('Control+S');
  await waitForServerSave(page);
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
  if (!hasNavigationDrawer(page)) return;
  const drawer = page.getByRole('button', { name: 'Open navigation' });
  await expect(drawer).toBeVisible();
  if ((await drawer.getAttribute('aria-expanded')) !== 'true')
    await drawer.click();
}

/** Closes the navigation drawer when one is open. */
export async function closeNavigation(page: Page): Promise<void> {
  if (!hasNavigationDrawer(page)) return;
  const close = page.getByRole('button', { name: 'Close navigation' });
  if (await close.isVisible()) await close.click();
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

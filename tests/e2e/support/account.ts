import { expect, type Page } from '@playwright/test';
import type { E2EStack } from './stack.ts';

/** Signs in through the same form that a person uses. */
export async function signIn(page: Page, stack: E2EStack): Promise<void> {
  await page.goto(`${stack.baseUrl}/login`);
  await page.getByLabel('Address').fill(stack.email);
  await page.getByLabel('Password').fill(stack.password);
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

/** Creates a note through the visible action in the main workspace content. */
export async function createNewNote(page: Page): Promise<void> {
  await page
    .locator('#notes-content')
    .getByRole('button', { name: 'Create a new note' })
    .first()
    .click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+$/);
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

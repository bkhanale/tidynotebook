import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPersonalWorkspace,
  signIn,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/**
 * Finds visible buttons whose accessible name does not contain the visible
 * label. WCAG "Label in Name" asks the accessible name to start with the text
 * a person reads, so a voice command can speak that text.
 */
async function labelInNameViolations(page: Page): Promise<string[]> {
  return page.locator('button:visible').evaluateAll((buttons) =>
    buttons.flatMap((button) => {
      const label = button.getAttribute('aria-label');
      if (label === null) return [];
      const text = (button.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text === '') return [];
      return label.toLowerCase().includes(text.toLowerCase())
        ? []
        : [`visible "${text}" but the accessible name is "${label}"`];
    }),
  );
}

test('every button accessible name contains its visible label', async ({
  checkedPage: page,
  stack,
}) => {
  await page.goto(`${stack.baseUrl}/login`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await labelInNameViolations(page)).toEqual([]);

  await signIn(page, stack);
  await openPersonalWorkspace(page);
  expect(await labelInNameViolations(page)).toEqual([]);

  await createNewNote(page);
  await page.getByLabel('Note name').fill(`labels-${Date.now().toString()}`);
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(await labelInNameViolations(page)).toEqual([]);
});

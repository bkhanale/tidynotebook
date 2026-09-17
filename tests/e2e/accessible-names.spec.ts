import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openNavigation,
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

test('the workspace switcher states what it is and what is open', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  // A narrow viewport keeps the sidebar in a closed drawer, so the switcher is
  // not on the screen until the drawer opens.
  await openNavigation(page);

  // The trigger shows the workspace name, which says what the menu is about
  // and not what the control does. Its accessible name has to say both, and
  // it has to keep the visible text so speech input reaches it.
  const trigger = page.getByRole('button', { name: /^Workspace: / });
  await expect(trigger).toHaveAccessibleName('Workspace: Personal');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: /^Workspace: / });

  // The menu chooses between workspaces, so the open one is stated and not
  // only drawn.
  await expect(
    menu.getByRole('menuitemradio', { name: 'Personal', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    menu.getByRole('menuitemradio', { name: 'New workspace' }),
  ).toBeVisible();
  expect(await labelInNameViolations(page)).toEqual([]);

  // Escape closes it and focus goes back to the trigger, so a person who
  // changes their mind is where they started.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

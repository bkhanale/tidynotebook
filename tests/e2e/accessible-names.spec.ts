import type { Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openNavigation,
  openPersonalWorkspace,
  openSignInForm,
  replaceEditorText,
  runNoteAction,
  signIn,
  waitForServerSave,
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
  await openSignInForm(page, `${stack.baseUrl}/login`);
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

test('two rows of one list carry two names', async ({
  checkedPage: page,
  stack,
}) => {
  // The defect this covers: `Button` applied a label only when the button
  // held no children, so a label given to a button that also shows text was
  // dropped in silence. Every row of Trash then carried the name `Restore`,
  // and a person who reads the screen with a screen reader heard the same
  // word for each one.
  await signIn(page, stack);
  await openPersonalWorkspace(page);

  const stamp = Date.now().toString();
  const first = `alpha-${stamp}`;
  const second = `beta-${stamp}`;
  for (const name of [first, second]) {
    await createNewNote(page);
    await page.getByLabel('Note name').fill(name);
    await replaceEditorText(page, `# ${name}\n`);
    await waitForServerSave(page);
    await runNoteAction(page, 'Delete this note');
    await expect(page.getByText(`${name} moved to Trash.`)).toBeVisible();
  }

  await runNoteAction(page, 'Go to Trash');
  await expect(
    page.getByRole('heading', { name: 'Trash', level: 1 }),
  ).toBeVisible();

  // Each row names the note it acts on, so the two rows are told apart by
  // name alone and speech input reaches the right one.
  for (const name of [first, second]) {
    await expect(
      page.getByRole('button', { name: `Restore ${name}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Delete permanently: ${name}` }),
    ).toBeVisible();
  }
  // The visible word is still the start of each name, so nothing here breaks
  // the rule that the first journey of this file holds.
  expect(await labelInNameViolations(page)).toEqual([]);
});

test('an empty state states its title as a heading', async ({
  checkedPage: page,
  stack,
}) => {
  // The defect this covers: `EmptyState` wrote its title in a paragraph with
  // the weight and the size of a heading, so the title was absent from the
  // heading list of every empty screen.
  await signIn(page, stack);
  await openPersonalWorkspace(page);

  // This workspace has published nothing, so the screen is empty and it is
  // the empty state that names it.
  await openNavigation(page);
  await page.getByRole('link', { name: 'Published links' }).click();
  await expect(
    page.getByRole('heading', { name: 'Published links', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No published links', level: 2 }),
  ).toBeVisible();
});

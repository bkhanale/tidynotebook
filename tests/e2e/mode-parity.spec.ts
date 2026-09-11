import type { Locator } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPersonalWorkspace,
  replaceEditorText,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/** Reads the computed values that define one part of a note. */
async function styleValues(
  locator: Locator,
  properties: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  return await locator.evaluate(
    (element, names) =>
      Object.fromEntries(
        names.map((name) => [
          name,
          getComputedStyle(element).getPropertyValue(name),
        ]),
      ),
    properties,
  );
}

test('Read and Write use the same note typography', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await page.getByLabel('Note name').fill('Mode parity');
  await replaceEditorText(page, '# Heading\n\nBody with `code`.\n\n- [ ] Task');
  await page.locator('.cm-content').press('Control+Home');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitForServerSave(page);

  const bodyProperties = [
    'color',
    'font-family',
    'font-size',
    'line-height',
    'max-width',
    'padding-bottom',
    'padding-top',
  ];
  const headingProperties = [
    'color',
    'font-size',
    'font-weight',
    'line-height',
    'max-width',
    'padding-bottom',
    'padding-top',
  ];
  const codeProperties = [
    'background-color',
    'border-radius',
    'font-family',
    'font-size',
    'padding-left',
    'padding-right',
  ];
  const taskProperties = [
    'accent-color',
    'height',
    'margin-right',
    'vertical-align',
    'width',
  ];

  const writeBody = await styleValues(
    page.locator('.cm-line').filter({ hasText: 'Body with' }),
    bodyProperties,
  );
  const writeHeading = await styleValues(
    page.locator('.cm-np-h1'),
    headingProperties,
  );
  const writeCode = await styleValues(
    page.locator('.cm-np-code'),
    codeProperties,
  );
  const writeTask = await styleValues(
    page.locator('.cm-np-task'),
    taskProperties,
  );

  await page.getByRole('button', { name: 'Read', exact: true }).click();
  const read = page.locator('[data-note-view="read"]');
  await expect(read).toBeVisible();

  expect(await styleValues(read.locator('p'), bodyProperties)).toEqual(
    writeBody,
  );
  expect(await styleValues(read.locator('h1'), headingProperties)).toEqual(
    writeHeading,
  );
  expect(await styleValues(read.locator('code'), codeProperties)).toEqual(
    writeCode,
  );
  expect(
    await styleValues(read.locator('input[type="checkbox"]'), taskProperties),
  ).toEqual(writeTask);
});

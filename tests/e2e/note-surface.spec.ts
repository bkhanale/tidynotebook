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

test('the palette and link commands use separate keys', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await replaceEditorText(page, 'Link text');

  const palette = page.getByRole('dialog', {
    name: 'Search notes and run actions',
  });
  await page.locator('.cm-content').press('Control+P');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  const editor = page.locator('.cm-content');
  await editor.press('Control+A');
  await editor.press('Control+K');
  await expect(editor).toContainText('[Link text]()');
  await expect(palette).toBeHidden();
});

test('one surface reads and writes the note in place', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await page.getByLabel('Note name').fill('One surface');
  await replaceEditorText(
    page,
    '---\ntitle: Example\ntags: [one, two]\n---\n\n# Heading\n\nBody with `code`.\n\n- [ ] Task\n\n| Name | Count |\n| :--- | ----: |\n| Alpha | 2 |\n\n```js\nconst answer = 42;\n```\n',
  );
  // Move the caret onto an empty line, away from every construct, so each
  // one renders instead of showing its source.
  await page.locator('.cm-content').press('Control+Home');
  await page.locator('.cm-content').press('ArrowDown');
  // The note saves itself; a version follows the typing pause and reaches the
  // server, so there is no Save button to press.
  await waitForServerSave(page);
  await page.reload();

  // The one surface renders every construct in place.
  await expect(page.locator('.cm-np-front-matter')).toHaveCount(4);
  await expect(page.locator('.cm-np-h2')).toHaveCount(0);
  await expect(page.locator('.cm-np-rule')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('title: Example');
  await expect(page.locator('.cm-np-h1')).toHaveText('Heading');
  await expect(page.locator('.cm-np-code')).toHaveText('code');
  await expect(page.locator('.cm-np-task')).toBeVisible();
  await expect(page.locator('.cm-np-table-head').first()).toContainText('Name');
  await expect(page.locator('.cm-np-align-right').last()).toContainText('2');
  await expect(page.locator('.cm-np-code-block-line').first()).toBeVisible();

  // A table renders with column alignment but stays editable Markdown text.
  await expect(page.locator('.cm-content')).toContainText('| Alpha | 2 |');

  // The code fence lines hide while the caret sits away from the block, so the
  // ``` markers are gone from the surface but the code stays.
  await expect(page.locator('.cm-content')).toContainText('const answer = 42;');
  await expect(page.locator('.cm-content')).not.toContainText('```');

  // There is no Write and Read toggle any more: one surface, not two.
  await expect(
    page.getByRole('button', { name: 'Read', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Write', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-note-view="read"]')).toHaveCount(0);
});

test('the note name and note text share one left edge', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await replaceEditorText(page, 'Left edge');

  const title = page.getByLabel('Note name');
  const line = page.locator('.cm-line').first();
  const titleEdge = await title.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left + Number.parseFloat(getComputedStyle(element).paddingLeft);
  });
  const lineEdge = await line.evaluate(
    (element) => element.getBoundingClientRect().left,
  );
  expect(Math.abs(titleEdge - lineEdge)).toBeLessThanOrEqual(1);
});

test('the active line stays clear inside a code block', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await replaceEditorText(page, '```js\nfirst\nsecond\n```');

  const codeLine = page
    .locator('.cm-np-code-block-line')
    .filter({ hasText: 'first' });
  await codeLine.click();
  await expect(codeLine).toHaveClass(/cm-activeLine/);
  const style = await codeLine.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth,
      outlineColor: computed.outlineColor,
      backgroundColor: computed.backgroundColor,
    };
  });
  expect(style.outlineStyle).toBe('solid');
  expect(style.outlineWidth).not.toBe('0px');
  expect(style.outlineColor).not.toBe(style.backgroundColor);
});

test('a table renders as columns that line up', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await replaceEditorText(
    page,
    'Intro\n\n| Name | Count |\n| :--- | ----: |\n| A | 2 |\n| Much longer cell | 30 |\n',
  );
  // The caret sits away from the table, so every row renders instead of
  // showing its source.
  await page.locator('.cm-content').press('Control+Home');

  const head = page.locator('.cm-np-table-head').first();
  const firstBodyCell = page.locator('.cm-np-table-cell').first();
  await expect(head).toBeVisible();

  const display = await head.evaluate(
    (element) => getComputedStyle(element).display,
  );
  expect(display).toBe('table-cell');

  // A column of the table has one left edge and one width over every row,
  // which is what makes it a table instead of raw text.
  const box = async (locator: typeof head): Promise<DOMRect> =>
    await locator.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
  const headBox = await box(head);
  const cellBox = await box(firstBodyCell);
  expect(Math.abs(headBox.left - cellBox.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(headBox.width - cellBox.width)).toBeLessThanOrEqual(1);

  // The table is still Markdown text: nothing is hidden and every cell can
  // be edited where it stands.
  await expect(page.locator('.cm-content')).toContainText(
    '| Much longer cell | 30 |',
  );
});

test('the note name sits close above the note text', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await replaceEditorText(page, 'First line');

  const gap = await page.evaluate(() => {
    const title = document.querySelector('input[aria-label="Note name"]');
    const line = document.querySelector('.cm-line');
    if (title === null || line === null) return Number.NaN;
    return (
      line.getBoundingClientRect().top - title.getBoundingClientRect().bottom
    );
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(24);
});

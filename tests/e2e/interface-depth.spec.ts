/**
 * The interface states its structure before a person reads a word.
 *
 * These journeys hold the parts of
 * [design 010](../../docs/design/010-depth-and-hierarchy.md) that only a real
 * browser can prove: the composition of the note screen, the order of the
 * three planes, and whether a divider actually paints. A class name in a unit
 * test proves none of them, which is how the divider of the note list stayed
 * invisible while the class was there the whole time.
 */
import type { Page } from '@playwright/test';
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

/** The left edge and the centre of one element, in page pixels. */
async function boxOf(
  page: Page,
  selector: string,
): Promise<{ left: number; centre: number; width: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`${selector} has no box.`);
  return { left: box.x, centre: box.x + box.width / 2, width: box.width };
}

test('the note name, the text and the footer share one centred column', async ({
  checkedPage: page,
  stack,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await page.getByLabel('Note name').fill('One column');
  await replaceEditorText(page, '# Roadmap\n\nThe plan for this quarter.\n');
  await waitForServerSave(page);

  const name = await boxOf(page, 'input[aria-label="Note name"]');
  const line = await boxOf(page, '.cm-line');
  const footer = await boxOf(page, 'footer span');

  // Decision 0052. The three parts of one page start on one left edge.
  expect(Math.abs(name.left - line.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(footer.left - line.left)).toBeLessThanOrEqual(1);

  // The column is centred in the space the note screen owns, so the distance
  // left of the text and the distance right of it are the same. A pinned
  // column put the whole difference on the right.
  const surface = await boxOf(page, '.cm-scroller');
  const before = line.left - surface.left;
  const after = surface.left + surface.width - (line.left + line.width);
  expect(Math.abs(before - after)).toBeLessThanOrEqual(2);
  expect(before).toBeGreaterThan(0);
});

test('the side region takes no width from the note text', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await page.getByLabel('Note name').fill('Wide enough');
  await replaceEditorText(page, '# Heading\n\nA line of the note.\n');
  await waitForServerSave(page);

  const region = page.getByRole('complementary', {
    name: 'Note outline and inbound links',
  });

  // Decision 0052. At the large width the region shortened every line, so it
  // is not in the frame until the extra large width.
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(region).toBeHidden();

  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(region).toBeVisible();
});

test('a note with no heading shows no outline section', async ({
  checkedPage: page,
  stack,
}) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await page.getByLabel('Note name').fill('No headings');
  await replaceEditorText(page, 'Just a paragraph, with no heading in it.\n');
  await waitForServerSave(page);

  const region = page.getByRole('complementary', {
    name: 'Note outline and inbound links',
  });
  await expect(region).toBeVisible();
  await expect(region.getByRole('button', { name: 'Outline' })).toBeHidden();

  // The same note with a heading states its outline.
  await replaceEditorText(page, '# Now it has one\n\nAnd a paragraph.\n');
  await expect(region.getByRole('button', { name: 'Outline' })).toBeVisible();
});

test('the chrome, the page and a raised surface are three planes', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);

  /** One custom property of the active palette. */
  const token = async (name: string): Promise<string> =>
    await page.evaluate(
      (property) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue(property)
          .trim(),
      name,
    );
  /** One painted colour, as the browser reports it. */
  const fill = async (selector: string): Promise<string> =>
    await page
      .locator(selector)
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);
  /** The same colour, as the browser reports a hex value of the palette. */
  const painted = async (hex: string): Promise<string> =>
    await page.evaluate((value) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = value;
      document.body.append(probe);
      const found = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return found;
    }, hex);

  // Decision 0049. The frame header joins the sidebar on the chrome plane and
  // the route below it sits on the page plane, which is the brighter of the
  // two in every palette of the registry.
  const chrome = await painted(await token('--notes-surface'));
  const pagePlane = await painted(await token('--notes-bg'));
  expect(chrome).not.toBe(pagePlane);
  expect(await fill('header')).toBe(chrome);
  expect(await fill('aside#notes-sidebar')).toBe(chrome);
  expect(await fill('div.bg-app')).toBe(pagePlane);

  // A raised thing stands above the page with a named elevation step.
  await page.locator('body').press('Control+P');
  const palette = page.getByRole('dialog', {
    name: 'Search notes and run actions',
  });
  await expect(palette).toBeVisible();
  const raised = await palette.evaluate((node) => {
    const style = getComputedStyle(node);
    return { fill: style.backgroundColor, shadow: style.boxShadow };
  });
  expect(raised.fill).toBe(await painted(await token('--notes-surface-card')));
  expect(raised.shadow).not.toBe('none');
});

test('a note list row draws the divider under it', async ({
  checkedPage: page,
  stack,
}) => {
  await signIn(page, stack);
  const workspaceId = await openPersonalWorkspace(page);
  for (const name of ['First note', 'Second note']) {
    await createNewNote(page);
    await page.getByLabel('Note name').fill(name);
    await replaceEditorText(page, `The text of ${name}.\n`);
    await waitForServerSave(page);
  }
  await page.goto(`${stack.baseUrl}/w/${workspaceId}`);

  const rows = page.locator('main ul > li');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);

  // The divider belongs to the row. It sat on the link inside the row before,
  // and a link is the only child of its row, so `last:border-b-0` matched
  // every row and no divider ever painted.
  const measured = await rows.evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        width: style.borderBottomWidth,
        colour: style.borderBottomColor,
      };
    }),
  );
  for (const row of measured.slice(0, -1)) {
    expect(row.width).not.toBe('0px');
    expect(row.colour).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(measured[measured.length - 1]?.width).toBe('0px');
});

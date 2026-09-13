import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import { openPersonalWorkspace, signIn } from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

/** Reports whether the page scrolls sideways. */
async function overflow(
  page: Page,
): Promise<{ client: number; scroll: number }> {
  return page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
}

/** Asserts that every target reaches the 44 px touch minimum. */
async function expectTouchTargets(
  page: Page,
  targets: readonly Locator[],
): Promise<void> {
  for (const target of targets) {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) continue;
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  }
}

test('the phone layout does not overflow and keeps 44 px targets', async ({
  checkedPage: page,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'phone-390',
    'The phone project covers the touch layout.',
  );
  await signIn(page, stack);
  await openPersonalWorkspace(page);

  const workspace = await overflow(page);
  expect(workspace.scroll).toBeLessThanOrEqual(workspace.client);

  await expectTouchTargets(page, [
    page.getByRole('button', { name: 'Open navigation' }),
    page.getByRole('button', { name: /Search notes/ }),
    page.getByRole('button', { name: 'More actions' }),
  ]);

  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Notes navigation' });
  await expect(drawer).toBeVisible();
  await expectTouchTargets(page, [
    drawer.getByRole('button', { name: 'Close navigation' }),
    drawer.getByRole('button', { name: 'New note', exact: true }),
    drawer.getByRole('button', { name: 'New folder', exact: true }),
    drawer.getByRole('link', { name: 'Trash' }),
  ]);

  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  if (drawerBox !== null)
    expect(Math.round(drawerBox.width)).toBeLessThanOrEqual(workspace.client);
});

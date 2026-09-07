import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import { openPersonalWorkspace, signIn } from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('login has loaded theme and layout styles', async ({
  checkedPage: page,
  stack,
}) => {
  await page.goto(`${stack.baseUrl}/login`);
  await expect(
    page.getByRole('heading', { name: 'Sign in to notesapp' }),
  ).toBeVisible();
  const style = await page.locator('.notes-auth-card').evaluate((card) => {
    const computed = getComputedStyle(card);
    return {
      display: getComputedStyle(card.parentElement as Element).display,
      background: computed.backgroundColor,
      radius: computed.borderRadius,
    };
  });
  expect(style.display).toBe('flex');
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.radius).not.toBe('0px');
});

test('workspace fits the viewport and the mobile drawer manages focus', async ({
  checkedPage: page,
  stack,
}, testInfo) => {
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

  const initialTheme = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /Switch to/ }).click();
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-theme',
    initialTheme ?? '',
  );

  const viewport = page.viewportSize();
  if ((viewport?.width ?? 1000) <= 768) {
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await expect(menu).toBeVisible();
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Notes navigation' });
    await expect(drawer).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.locator('#notes-sidebar a, #notes-sidebar button').first(),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
  } else {
    await expect(page.getByLabel('Notes navigation')).toBeVisible();
  }

  if (testInfo.project.name === 'phone-390') {
    await expect(
      page.getByRole('button', { name: 'Create a new note' }).first(),
    ).toBeInViewport();
    await expect(
      page.getByRole('button', { name: /Switch to/ }),
    ).toBeInViewport();
  }
});

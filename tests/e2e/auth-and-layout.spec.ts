import { test, expect } from './support/stack.ts';
import { prepareCleanBrowser } from './support/browser-state.ts';
import {
  createNewNote,
  openPersonalWorkspace,
  replaceEditorText,
  runNoteAction,
  openSignInForm,
  signIn,
  waitForServerSave,
} from './support/account.ts';

test.beforeEach(async ({ context }) => prepareCleanBrowser(context));

test('login has loaded theme and layout styles', async ({
  checkedPage: page,
  stack,
}) => {
  await openSignInForm(page, `${stack.baseUrl}/login`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const style = await page
    .getByRole('heading', { name: 'Sign in' })
    .locator('..')
    .evaluate((card) => {
      const computed = getComputedStyle(card);
      const parent = card.parentElement;
      if (parent === null)
        throw new Error('The sign in card sits in no parent element.');
      return {
        display: getComputedStyle(parent).display,
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
  context,
  stack,
}, testInfo) => {
  await context.addInitScript(() => {
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window.crypto, 'subtle', {
      configurable: true,
      value: undefined,
    });
  });
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

  // The theme is a command now, and one press moves the appearance.
  const initialTheme = await page.locator('html').getAttribute('data-theme');
  await runNoteAction(page, 'Toggle theme');
  await runNoteAction(page, 'Toggle theme');
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-theme',
    initialTheme ?? '',
  );

  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) {
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
    await expect(page.locator('#notes-sidebar')).toBeVisible();
  }

  if (testInfo.project.name === 'phone-390') {
    await expect(
      page.getByRole('button', { name: 'Open navigation' }),
    ).toBeInViewport();
    await expect(
      page.getByRole('button', { name: /Search notes/ }),
    ).toBeInViewport();
  }
});

test('plain HTTP browser capabilities do not block note saves', async ({
  checkedPage: page,
  context,
  stack,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'One engine covers the insecure-context capability contract.',
  );
  await context.addInitScript(() => {
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window.crypto, 'subtle', {
      configurable: true,
      value: undefined,
    });
  });
  await signIn(page, stack);
  await openPersonalWorkspace(page);
  await createNewNote(page);
  await page
    .getByLabel('Note name')
    .fill(`plain-http-${Date.now().toString()}`);
  await replaceEditorText(page, '# Plain HTTP\n\nThe note stays durable.');
  await waitForServerSave(page);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText(
    'The note stays durable.',
  );
});

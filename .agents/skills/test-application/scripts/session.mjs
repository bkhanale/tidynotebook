/**
 * Helpers for a drive script of one worktree.
 *
 * A drive script lives in `.local-app/` and imports this file by its path:
 *
 *     import { chromium } from 'playwright';
 *     import { openDevice, readApp } from '../.agents/skills/test-application/scripts/session.mjs';
 *
 * This file imports nothing from Playwright. It takes the browser, the
 * context or the page that the drive script made, so it runs with the one
 * Playwright of `.local-app/`. The repository holds no Playwright (record
 * 0066), so the types below name only the part of it that this file uses.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ status(): number, url(): string, ok(): boolean, json(): Promise<unknown>, request(): { method(): string } }} Answer
 * @typedef {{ fill(text: string): Promise<void>, click(): Promise<void>, waitFor(): Promise<void>, first(): Locator }} Locator
 * @typedef {{
 *   goto(url: string): Promise<unknown>,
 *   url(): string,
 *   locator(selector: string): Locator,
 *   getByRole(role: string, options: { name: string }): Locator,
 *   getByText(text: string): Locator,
 *   waitForURL(url: RegExp): Promise<void>,
 *   waitForLoadState(state: 'networkidle'): Promise<void>,
 *   evaluate(expression: string): Promise<unknown>,
 *   screenshot(options: { path: string }): Promise<unknown>,
 *   on(event: 'pageerror', listener: (error: Error) => void): unknown,
 *   request: { get(url: string): Promise<Answer> },
 * }} Page
 * @typedef {{
 *   newPage(): Promise<Page>,
 *   close(): Promise<void>,
 *   on(event: 'response', listener: (answer: Answer) => void): unknown,
 * }} Context
 * @typedef {{ width: number, height: number }} Viewport
 * @typedef {{ newContext(options: { viewport: Viewport, colorScheme: 'light' | 'dark' }): Promise<Context> }} Browser
 * @typedef {{ origin: string, email: string, password: string }} App
 * @typedef {{ context: Context, page: Page, problems: string[] }} Device
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The size of a laptop screen, which every screen of the design supports. */
const laptop = { width: 1280, height: 800 };

/**
 * The application of this worktree, as `app.mjs start` wrote it.
 *
 * @returns {Promise<App>}
 */
export async function readApp() {
  const file = join(root, '.local-app', 'app.json');
  /** @type {unknown} */
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value === null || typeof value !== 'object')
    throw new Error(`${file} holds no application. Run app.mjs start.`);
  /** @param {string} key @returns {string} */
  const text = (key) => {
    /** @type {unknown} */
    const field = Reflect.get(value, key);
    if (typeof field !== 'string') throw new Error(`${file} lacks ${key}.`);
    return field;
  };
  return {
    origin: text('origin'),
    email: text('email'),
    password: text('password'),
  };
}

/**
 * Opens one device and signs it in.
 *
 * A device is one browser context: its own session cookie, IndexedDB,
 * service worker and cache, as a second computer has. The page errors and
 * failed requests it meets are collected in `problems`, apart from the one
 * answer 401 of the session check before the sign-in.
 *
 * @param {Browser} browser
 * @param {App} app
 * @param {{ colorScheme?: 'light' | 'dark', viewport?: Viewport | undefined }} [options]
 * @returns {Promise<Device>}
 */
export async function openDevice(browser, app, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? laptop,
    colorScheme: options.colorScheme ?? 'light',
  });
  /** @type {string[]} */
  const problems = [];
  context.on('response', (answer) => {
    const status = answer.status();
    const signInCheck = status === 401 && answer.url().endsWith('/api/account');
    if (status >= 400 && !signInCheck)
      problems.push(`${status} ${answer.request().method()} ${answer.url()}`);
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  await page.goto(app.origin);
  await page.locator('input[type=email]').fill(app.email);
  await page.locator('input[type=password]').fill(app.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/w\//);
  // The first pull brings the notes of the workspace. A note made before it
  // ends can take a name that the server already holds, and its save is
  // refused with `path_conflict`.
  await page.waitForLoadState('networkidle');
  return { context, page, problems };
}

/**
 * The Markdown that the server holds for the note that a page shows.
 *
 * The page must show a note, whose address is `/w/<workspace>/notes/<file>`.
 * The read goes through the session of the device of that page. The answer
 * is `null` while the server does not hold the note.
 *
 * @param {Page} page
 * @returns {Promise<string | null>}
 */
export async function readNoteText(page) {
  const match = /\/w\/([^/]+)\/notes\/([^/?#]+)/.exec(page.url());
  if (match === null) throw new Error(`${page.url()} shows no note.`);
  const origin = new URL(page.url()).origin;
  const answer = await page.request.get(
    `${origin}/api/workspaces/${match[1] ?? ''}/files/${match[2] ?? ''}`,
  );
  // A note that the device just made is not on the server until its first
  // save arrives, so the server holds no text of it yet.
  if (answer.status() === 404) return null;
  if (!answer.ok())
    throw new Error(`The note read answered ${answer.status()}.`);
  /** @type {unknown} */
  const body = await answer.json();
  /** @type {unknown} */
  const head =
    body !== null && typeof body === 'object'
      ? Reflect.get(body, 'head')
      : null;
  /** @type {unknown} */
  const text =
    head !== null && typeof head === 'object'
      ? Reflect.get(head, 'text')
      : null;
  return typeof text === 'string' ? text : null;
}

// Sync between devices takes well under a second on one machine. Fifteen
// seconds covers a cold build and a busy database and still ends a wait for
// something that never comes.
const untilTimeoutMs = 15_000;
// A check runs ten times a second, which is fast next to a sync.
const untilPollMs = 100;

/**
 * Waits until `check` answers true, or fails with `what` in the message.
 *
 * Use it for a state that no locator reaches, such as the text on the server.
 *
 * @param {() => boolean | Promise<boolean>} check
 * @param {string} what What the wait is for, in words.
 * @param {number} [timeoutMs]
 */
export async function until(check, what, timeoutMs = untilTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error(`Waited ${timeoutMs} ms for ${what}.`);
    await new Promise((done) => setTimeout(done, untilPollMs));
  }
}

/**
 * Opens another tab of one device, which shares its session and storage.
 *
 * @param {Device} device
 * @param {string} [url] The address to open, by default the address of the first tab.
 * @returns {Promise<Page>}
 */
export async function openTab(device, url) {
  const page = await device.context.newPage();
  await page.goto(url ?? device.page.url());
  return page;
}

/**
 * Makes a page read as hidden or visible, as a switch of tabs does.
 *
 * Every page of a headless browser stays visible, so a switch away from a
 * tab never happens by itself. This sets `document.visibilityState` and
 * sends `visibilitychange`, which is what the application listens for.
 *
 * @param {Page} page
 * @param {'hidden' | 'visible'} state
 */
export async function setVisibility(page, state) {
  // The expression runs in the page, so it is text: this file has no DOM.
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => ${JSON.stringify(state)},
    });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
}

/**
 * Takes one screenshot of an address in light and one in dark.
 *
 * Each scheme gets a new signed in device, because a page that changes its
 * scheme while it is open paints a moment of the old palette. The files are
 * `<file>-light.png` and `<file>-dark.png`, and the answer names them.
 *
 * @param {Browser} browser
 * @param {App} app
 * @param {string} url
 * @param {string} file A path without its extension.
 * @param {{ viewport?: Viewport, ready?: string }} [options]
 *   `ready` is a text that the screen shows once it is complete. The
 *   screenshot waits for it, and without it only for the network.
 * @returns {Promise<string[]>}
 */
export async function screenshotBoth(browser, app, url, file, options = {}) {
  /** @type {string[]} */
  const files = [];
  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    const device = await openDevice(browser, app, {
      viewport: options.viewport,
      colorScheme,
    });
    await device.page.goto(url);
    await device.page.waitForLoadState('networkidle');
    if (options.ready !== undefined)
      await device.page.getByText(options.ready).first().waitFor();
    const path = `${file}-${colorScheme}.png`;
    await device.page.screenshot({ path });
    files.push(path);
    await device.context.close();
  }
  return files;
}

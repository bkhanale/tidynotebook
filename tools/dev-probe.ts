import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4321';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true });
await page.addInitScript(() => {
  localStorage.setItem('notesapp.sidebar', JSON.stringify({ step: 'narrow', collapsed: false }));
});
await page.goto(`${base}/login`);
await page.getByLabel('Address').fill('owner@dev.invalid');
await page.getByLabel('Password', { exact: true }).fill('dev-owner-password');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/w\/[0-9a-f-]+$/);
await page.waitForTimeout(1000);

async function createTopFolder(name: string): Promise<void> {
  await page.getByRole('link', { name: 'All notes' }).click();
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByLabel('Folder name').fill(name);
  await dialog.getByRole('button', { name: 'Make folder' }).click();
  await page.waitForTimeout(150);
}
const tree = page.locator('#notes-sidebar div.overflow-y-auto').first();
let last = '';
for (let i = 1; i <= 24; i += 1) {
  last = `Folder ${String(i).padStart(2, '0')}`;
  await createTopFolder(last);
  const box = await tree.boundingBox();
  const rows = await tree.evaluate((n) => n.scrollHeight);
  if (box && rows > box.height) break;
}
const trigger = page.getByRole('button', { name: `Actions for the folder ${last}` });
await trigger.scrollIntoViewIfNeeded();
await trigger.click();
await page.waitForTimeout(500);
const anchor = await trigger.boundingBox();
const menu = page.getByRole('menu');
const box = await menu.boundingBox();
const info = await menu.evaluate((n) => ({
  top: n.style.top, left: n.style.left, maxHeight: n.style.maxHeight,
  innerHeight: window.innerHeight, rect: n.getBoundingClientRect().height,
}));
console.log('last', last);
console.log('anchor', JSON.stringify(anchor));
console.log('box', JSON.stringify(box));
console.log('info', JSON.stringify(info));
console.log('tree', JSON.stringify(await tree.boundingBox()));
await page.screenshot({ path: '/tmp/napp/probe.png' });
await browser.close();

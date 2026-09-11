import assert from 'node:assert/strict';
import test from 'node:test';
import { drawerClassName } from './drawer.ts';

await test('a closed drawer is hidden below the medium width', () => {
  const closed = drawerClassName(false).split(' ');
  assert.ok(closed.includes('max-md:invisible'));
  assert.ok(closed.includes('-translate-x-full'));
  // From the medium width up the drawer is a part of the frame.
  assert.ok(closed.includes('md:visible'));
  assert.ok(closed.includes('md:translate-x-0'));
});

await test('an open drawer is shown and hides nothing', () => {
  const open = drawerClassName(true).split(' ');
  assert.ok(open.includes('translate-x-0'));
  assert.ok(!open.includes('max-md:invisible'));
});

await test('the phone drawer covers the header and the md drawer does not', () => {
  const open = drawerClassName(true).split(' ');
  // On a phone the panel starts at the top edge of the screen, above the
  // header, so no band of the page shows over it.
  assert.ok(open.includes('top-0'));
  assert.ok(open.includes('z-50'));
  // From the medium width up it is a part of the frame below the header.
  assert.ok(open.includes('md:top-header'));
  assert.ok(open.includes('md:z-40'));
});

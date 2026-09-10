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

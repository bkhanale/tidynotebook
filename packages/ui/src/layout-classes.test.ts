/** The pure layout choices of shared page furniture. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pageHeaderActionsClassName } from './layout-classes.ts';

await test('split page actions occupy the row and keep its two ends', () => {
  const classes = pageHeaderActionsClassName('split').split(' ');

  assert.ok(classes.includes('w-full'));
  assert.ok(classes.includes('justify-between'));
  assert.ok(classes.includes('gap-group'));
  assert.ok(!classes.includes('shrink-0'));
});

await test('clustered page actions keep their compact default', () => {
  const classes = pageHeaderActionsClassName('cluster').split(' ');

  assert.ok(classes.includes('shrink-0'));
  assert.ok(classes.includes('gap-cluster'));
  assert.ok(!classes.includes('w-full'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { noteTitleClassName } from './note-header-layout.ts';

await test('the note name takes a line of its own on a phone', () => {
  const classes = noteTitleClassName().split(' ');
  // A full basis wraps the actions under the name below the small width.
  assert.ok(classes.includes('basis-full'));
  assert.ok(classes.includes('sm:basis-0'));
  assert.ok(classes.includes('grow'));
  // `flex-1` would set the basis again and win over both.
  assert.ok(!classes.includes('flex-1'));
});

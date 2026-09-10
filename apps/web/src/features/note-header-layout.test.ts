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

await test('the note name carries no box at rest', () => {
  const classes = noteTitleClassName().split(' ');
  // A title, not a form field: nothing frames it until the pointer or the
  // keyboard reaches it.
  assert.ok(classes.includes('border-0'));
  assert.ok(classes.includes('border-b-2'));
  assert.ok(classes.includes('border-transparent'));
  assert.ok(classes.includes('bg-transparent'));
  assert.ok(!classes.includes('rounded-lg'));
  assert.ok(!classes.some((name) => name.startsWith('focus:ring')));
  assert.ok(classes.includes('hover:border-edge-subtle'));
  assert.ok(classes.includes('focus:border-focus'));
});

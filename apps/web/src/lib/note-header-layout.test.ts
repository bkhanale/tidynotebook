import assert from 'node:assert/strict';
import test from 'node:test';
import {
  noteHeaderRowClassName,
  noteTitleClassName,
} from './note-header-layout.ts';

await test('the note name takes the full width of the header', () => {
  const classes = noteTitleClassName().split(' ');
  // The header carries the name alone, so the title spans the whole row and
  // never shares the line with a control.
  assert.ok(classes.includes('block'));
  assert.ok(classes.includes('w-full'));
  assert.ok(classes.includes('min-w-0'));
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

await test('the header row keeps the name close to the note text', () => {
  const classes = noteHeaderRowClassName().split(' ');
  // The name titles the text under it, so the space below the name is
  // smaller than the space above it and the note reads as one page.
  assert.ok(classes.includes('pt-3'));
  assert.ok(classes.includes('pb-1.5'));
  assert.ok(!classes.some((name) => name.startsWith('py-')));
});

await test('the header row stays at the top while the note scrolls', () => {
  const classes = noteHeaderRowClassName().split(' ');
  assert.ok(classes.includes('sticky'));
  assert.ok(classes.includes('top-0'));
  assert.ok(classes.includes('shrink-0'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  noteColumnClassName,
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
  assert.ok(classes.includes('hover:border-edge-line'));
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

await test('the note name is the largest text on the note screen', () => {
  const classes = noteTitleClassName().split(' ');
  // Decision 0015. The top of the note heading ramp is 1.75 times the body
  // size, which is 28 px, and this step is 30 px, so the name wins whatever
  // the note opens with.
  assert.ok(classes.includes('text-3xl'));
  assert.ok(classes.includes('tracking-display'));
});

await test('the name, the text and the footer share one centred column', () => {
  const column = noteColumnClassName().split(' ');
  // Decision 0055. The measure is the one in the central theme, and the
  // editor centres its own lines on the same value.
  assert.ok(column.includes('mx-auto'));
  assert.ok(column.includes('w-full'));
  assert.ok(column.includes('max-w-note'));
  // The row around the column pads by the same amount as the editor content,
  // so the name lands on the same left edge as the first line of the text.
  const row = noteHeaderRowClassName().split(' ');
  assert.ok(row.includes('px-2'));
  assert.ok(!row.some((name) => name.startsWith('sm:px-')));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  noteColumnClassName,
  noteFooterClassName,
  noteFrameClassName,
  noteOutlineScrollClassName,
  noteSideRegionClassName,
} from './note-column.ts';

await test('the text and the footer share one centred column', () => {
  const column = noteColumnClassName().split(' ');
  // Decision 0055. The measure is the one in the central theme, and the
  // editor centres its own lines on the same value.
  assert.ok(column.includes('mx-auto'));
  assert.ok(column.includes('w-full'));
  assert.ok(column.includes('max-w-note'));
});

await test('the column holds no name of its own', () => {
  // Decision 0069. The name is the last part of the breadcrumb, so nothing
  // here sets a title step or a title weight.
  const column = noteColumnClassName();
  assert.ok(!column.includes('text-3xl'));
  assert.ok(!column.includes('font-semibold'));
});

await test('the frame of the note draws no space above the text', () => {
  // The editor scrolls inside this frame, so padding here would stay on the
  // screen under the frame header while the text moved behind it. The space
  // above the first line belongs to the editor content instead.
  const frame = noteFrameClassName().split(' ');
  assert.ok(!frame.some((name) => name.startsWith('pt-')));
  assert.ok(!frame.some((name) => name.startsWith('py-')));
  assert.ok(!frame.some((name) => name.startsWith('p-')));
});

await test('the footer draws the one divider above itself', () => {
  // The note text is a region a person scrolls, so the design guide draws a
  // line there. It is `edge-line`, the one divider of the product.
  const footer = noteFooterClassName().split(' ');
  assert.ok(footer.includes('border-t'));
  assert.ok(footer.includes('border-edge-line'));
});

await test('the outline scrolls inside the note side region', () => {
  const side = noteSideRegionClassName().split(' ');
  const outline = noteOutlineScrollClassName().split(' ');
  assert.ok(side.includes('overflow-hidden'));
  assert.ok(side.includes('flex-col'));
  assert.ok(outline.includes('min-h-0'));
  assert.ok(outline.includes('overflow-y-auto'));
  assert.ok(outline.includes('overscroll-contain'));
});

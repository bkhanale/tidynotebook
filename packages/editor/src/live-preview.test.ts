/**
 * Live preview decorations and editor transactions.
 *
 * The scan tests check exact source ranges and prove the original text is
 * untouched. The transaction tests apply specs to a real `EditorState` and
 * check the resulting document, so undo grouping and selection behavior rest
 * on CodeMirror itself rather than on a mock.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import {
  findTaskBox,
  headingSpec,
  linkTargetAt,
  toggleTaskSpec,
} from './commands.ts';
import {
  isRevealed,
  partitionMarkers,
  scanBlockMarkers,
  scanTextMarkers,
} from './live-preview.ts';

await test('heading markers cover the hash run and style the text', () => {
  const text = '## Shopping list';
  const scan = scanTextMarkers(text);
  assert.deepEqual(scan.markers, [{ from: 0, to: 2, kind: 'heading' }]);
  assert.equal(scan.styles.length, 1);
  const style = scan.styles[0];
  assert.equal(style?.kind, 'heading');
  assert.equal(style?.level, 2);
  assert.equal(text.slice(style?.from ?? 0, style?.to ?? 0), 'Shopping list');
});

await test('a fenced block uses code style and does not parse headings', () => {
  const text = '```\n## not a heading\n```';
  const scan = scanTextMarkers(text);
  assert.ok(
    scan.markers.every((marker) => marker.kind === 'code'),
    'only fence markers are reported',
  );
  assert.deepEqual(scan.styles, [{ from: 4, to: 20, kind: 'code-block' }]);
});

await test('a block quote hides its marker and styles its content', () => {
  const text = '> Quoted **text**';
  const scan = scanTextMarkers(text);
  assert.deepEqual(scan.markers[0], { from: 0, to: 2, kind: 'quote' });
  const quote = scan.styles.find((span) => span.kind === 'quote');
  assert.equal(text.slice(quote?.from ?? 0, quote?.to ?? 0), 'Quoted **text**');
  const bold = scan.styles.find((span) => span.variant === 'bold');
  assert.equal(text.slice(bold?.from ?? 0, bold?.to ?? 0), 'text');
});

await test('emphasis markers surround the styled content', () => {
  const text = 'Buy **milk** and *bread*.';
  const scan = scanTextMarkers(text);
  const markers = scan.markers.filter((marker) => marker.kind === 'emphasis');
  assert.deepEqual(
    markers.map((marker) => text.slice(marker.from, marker.to)),
    ['**', '**', '*', '*'],
  );
  const bold = scan.styles.find((span) => span.variant === 'bold');
  assert.equal(text.slice(bold?.from ?? 0, bold?.to ?? 0), 'milk');
  const italic = scan.styles.find((span) => span.variant === 'italic');
  assert.equal(text.slice(italic?.from ?? 0, italic?.to ?? 0), 'bread');
});

await test('emphasis inside inline code is left alone', () => {
  const text = 'Use `a **b** c` here.';
  const scan = scanTextMarkers(text);
  assert.ok(
    scan.markers.every((marker) => marker.kind === 'code'),
    'code ticks are the only markers',
  );
});

await test('list bullets and task boxes are reported with exact ranges', () => {
  const text = '- [ ] milk\n1. bread';
  const scan = scanTextMarkers(text);
  assert.equal(text.slice(0, 1), '-');
  assert.deepEqual(
    scan.markers.map((marker) => ({ ...marker })),
    [
      { from: 0, to: 1, kind: 'list' },
      { from: 2, to: 5, kind: 'task' },
      { from: 11, to: 13, kind: 'list' },
    ],
  );
  assert.equal(text.slice(2, 5), '[ ]');
});

await test('links expose bracket markers and a styled label', () => {
  const text = 'See [notes](/notes/abc) and [[Shopping]].';
  const scan = scanTextMarkers(text);
  const open = scan.markers.find(
    (marker) =>
      marker.kind === 'link' && text.slice(marker.from, marker.to) === '[',
  );
  assert.ok(open !== undefined, 'an opening bracket marker exists');
  const label = scan.styles.find(
    (span) =>
      span.kind === 'link' && text.slice(span.from, span.to) === 'notes',
  );
  assert.ok(label !== undefined, 'the label is styled');
  // Double bracket text is not a link in v0.1, so it gets no link style.
  const brackets = scan.styles.find(
    (span) =>
      span.kind === 'link' && text.slice(span.from, span.to) === 'Shopping',
  );
  assert.equal(brackets, undefined, 'double bracket text stays plain');
});

await test('markers outside the selection hide and markers at the cursor reveal', () => {
  const text = '## Title\n\nSome **bold** text.';
  const scan = scanTextMarkers(text);
  const caret = text.indexOf('bold');
  const { hidden, revealed } = partitionMarkers(scan.markers, caret, caret);
  assert.ok(hidden.length > 0, 'distant markers hide');
  assert.ok(
    hidden.every((marker) => !isRevealed(marker.from, marker.to, caret, caret)),
    'every hidden marker sits outside the cursor',
  );
  const boldOpen = scan.markers.find(
    (marker) =>
      marker.kind === 'emphasis' && text.slice(marker.from, marker.to) === '**',
  );
  assert.ok(boldOpen !== undefined, 'a bold marker exists');
  assert.ok(
    revealed.some(
      (marker) => marker.from === boldOpen.from && marker.to === boldOpen.to,
    ),
    'the marker around the cursor is revealed',
  );
});

await test('a range selection reveals every marker it overlaps', () => {
  const text = '**one** and **two**';
  const scan = scanTextMarkers(text);
  const from = 0;
  const to = text.length;
  const { hidden } = partitionMarkers(scan.markers, from, to);
  assert.equal(hidden.length, 0);
});

await test('task boxes and code ticks are never hidden', () => {
  const text = '- [ ] milk\n`code`';
  const scan = scanTextMarkers(text);
  const { hidden } = partitionMarkers(scan.markers, text.length, text.length);
  assert.ok(
    hidden.every((marker) => marker.kind !== 'task' && marker.kind !== 'code'),
    'checkboxes and code ticks stay visible',
  );
  assert.ok(
    scan.markers.some((marker) => marker.kind === 'task'),
    'a task marker exists',
  );
});

await test('toggling a task flips the box through a transaction', () => {
  const state = EditorState.create({ doc: '- [ ] milk' });
  const spec = toggleTaskSpec(state);
  assert.ok(spec !== null, 'a change is described');
  const next = state.update(spec).state;
  assert.equal(next.doc.toString(), '- [x] milk');
  const back = next.update(toggleTaskSpec(next) ?? {}).state;
  assert.equal(back.doc.toString(), '- [ ] milk');
});

await test('toggling touches every selected task line and skips plain lines', () => {
  const state = EditorState.create({
    doc: '- [ ] one\nplain\n- [x] two',
    selection: { anchor: 0, head: 24 },
  });
  const spec = toggleTaskSpec(state);
  assert.ok(spec !== null, 'a change is described');
  const next = state.update(spec).state;
  assert.equal(next.doc.toString(), '- [x] one\nplain\n- [ ] two');
});

await test('toggling without a task returns null and keeps history clean', () => {
  const state = EditorState.create({ doc: 'just text' });
  assert.equal(toggleTaskSpec(state), null);
});

await test('findTaskBox reports the box and its checked state', () => {
  const box = findTaskBox('- [X] done', 10);
  assert.deepEqual(box, { from: 12, to: 15, checked: true });
  assert.equal(findTaskBox('- plain', 0), null);
});

await test('heading levels apply and clear through transactions', () => {
  const state = EditorState.create({ doc: 'Title' });
  const headed = state.update(headingSpec(state, 2) ?? {}).state;
  assert.equal(headed.doc.toString(), '## Title');
  const cleared = headed.update(headingSpec(headed, 2) ?? {}).state;
  assert.equal(cleared.doc.toString(), 'Title');
});

await test('link targets resolve at a position and miss plain text', () => {
  const text = 'See [notes](/notes/abc) here.';
  const inside = text.indexOf('notes') + 2;
  assert.deepEqual(linkTargetAt(text, inside), {
    kind: 'url',
    target: '/notes/abc',
  });
  const brackets = 'Open [[Shopping]] now.';
  assert.equal(linkTargetAt(brackets, brackets.indexOf('Shopping')), null);
  assert.equal(linkTargetAt(text, 0), null);
});

await test('typical note typing stays inside the module response target', () => {
  const paragraph =
    'A **typical** note has [links](/notes/example), tasks, and plain text.\n';
  const document = `# Performance note\n\n${paragraph.repeat(300)}`;
  let state = EditorState.create({ doc: document, extensions: [markdown()] });
  const samples: number[] = [];
  for (let index = 0; index < 60; index += 1) {
    const started = performance.now();
    state = state.update({
      changes: { from: state.doc.length, insert: 'x' },
      userEvent: 'input.type',
    }).state;
    const line = state.doc.lineAt(state.doc.length);
    scanBlockMarkers(line.text, line.from);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? 0;
  console.log(
    `typing transaction over ${String(samples.length)} runs: p95 ${p95.toFixed(2)} ms ` +
      `(Node module check, without browser paint or IME)`,
  );
  assert.ok(
    p95 < 50,
    `the typing target is 50 ms, measured ${p95.toFixed(2)} ms`,
  );
});

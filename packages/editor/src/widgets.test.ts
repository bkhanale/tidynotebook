/**
 * Widget checks.
 *
 * Two things are tested here. The region finder, which reads the syntax tree
 * and decides which ranges become widgets, and the view model, which decides
 * what one widget shows. Both are pure, so no DOM is needed. The element
 * builder in `./widgets.ts` is a direct translation of the view model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { noteMarkdown } from './language.ts';
import {
  attachmentIdOf,
  buildRichWidgets,
  findRichRegions,
  richLimits,
  shouldPreserveAsSource,
  widgetView,
  type RichWidget,
} from './widgets.ts';

/** Builds a state whose whole document is parsed. */
function stateOf(doc: string, selection?: number): EditorState {
  let state = EditorState.create({
    doc,
    extensions: [noteMarkdown()],
    ...(selection === undefined
      ? {}
      : { selection: { anchor: selection, head: selection } }),
  });
  for (
    let attempt = 0;
    attempt < 200 && syntaxTree(state).length < state.doc.length;
    attempt += 1
  ) {
    ensureSyntaxTree(state, state.doc.length, 5000);
    state = state.update({}).state;
  }
  return state;
}

const attachment = '/attachments/0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

await test('an attachment image alone on its line is a block region', () => {
  const doc = `text\n\n![shot](${attachment})\n\nmore\n`;
  const [region, ...rest] = findRichRegions(stateOf(doc, 0));
  assert.equal(rest.length, 0);
  assert.equal(region?.kind, 'image');
  assert.equal(region?.block, true);
  assert.equal(region?.content, 'shot');
  assert.equal(region?.destination, attachment);
  // The range covers the whole line, which is what a block widget needs.
  assert.equal(doc.slice(region?.from, region?.to), `![shot](${attachment})`);
});

await test('an image inside a sentence stays an inline region', () => {
  const doc = `see ![shot](${attachment}) here\n`;
  const [region] = findRichRegions(stateOf(doc, 0));
  assert.equal(region?.block, false);
});

await test('an external image is its own kind and never loads by itself', () => {
  const doc = '![alt](https://example.invalid/x.png)\n';
  const [region] = findRichRegions(stateOf(doc, 0));
  assert.equal(region?.kind, 'image-external');
  assert.ok(region !== undefined);
  const view = widgetView(region, {}, () => false);
  assert.equal(view.kind, 'image-placeholder');
  if (view.kind === 'image-placeholder') {
    assert.ok(view.label.includes('https://example.invalid/x.png'));
    assert.equal(view.action, 'Load');
  }
});

await test('an external image renders once the reader pressed Load', () => {
  const doc = '![alt](https://example.invalid/x.png)\n';
  const [region] = findRichRegions(stateOf(doc, 0));
  assert.ok(region !== undefined);
  const view = widgetView(region, {}, () => true);
  assert.equal(view.kind, 'image');
  if (view.kind === 'image') {
    assert.equal(view.url, 'https://example.invalid/x.png');
    assert.equal(view.external, true);
  }
});

await test('a mermaid fence is a diagram region and other fences are not', () => {
  const doc =
    '```mermaid\ngraph TD;\n  A-->B;\n```\n\n```js\nconst a = 1;\n```\n';
  const regions = findRichRegions(stateOf(doc, 0));
  assert.equal(regions.length, 1);
  assert.equal(regions[0]?.kind, 'diagram');
  assert.equal(regions[0]?.block, true);
  assert.equal(regions[0]?.content, 'graph TD;\n  A-->B;');
});

await test('display math is a block region and inline math is not', () => {
  const doc = 'a $$x^2$$ b\n\n$$\n\\int_0^1 x\n$$\n';
  const regions = findRichRegions(stateOf(doc, 0));
  assert.deepEqual(
    regions.map((region) => [region.kind, region.block, region.content]),
    [
      ['math-inline', false, 'x^2'],
      ['math-display', true, '\\int_0^1 x'],
    ],
  );
});

await test('the LaTeX parentheses form is inline math as well', () => {
  const doc = 'a \\(x^2\\) b\n';
  const [region] = findRichRegions(stateOf(doc, 0));
  assert.equal(region?.kind, 'math-inline');
  assert.equal(region?.content, 'x^2');
});

await test('one dollar is money and never math', () => {
  const doc = 'It costs $5 and $10 today.\n';
  assert.deepEqual(findRichRegions(stateOf(doc, 0)), []);
});

await test('a widget the selection touches is dropped so its source shows', () => {
  const doc = `text\n\n![shot](${attachment})\n\nmore\n`;
  const away = buildRichWidgets(stateOf(doc, 0), {});
  let count = 0;
  away.decorations.between(0, doc.length, () => {
    count += 1;
  });
  assert.equal(count, 1);
  const inside = buildRichWidgets(stateOf(doc, 10), {});
  let insideCount = 0;
  inside.decorations.between(0, doc.length, () => {
    insideCount += 1;
  });
  assert.equal(insideCount, 0);
});

await test('the remaining widgets are declared as atomic ranges', () => {
  const doc = `![shot](${attachment})\n\ntail\n`;
  const set = buildRichWidgets(stateOf(doc, doc.length), {});
  const atomic: Array<[number, number]> = [];
  set.atomic.between(0, doc.length, (from, to) => {
    atomic.push([from, to]);
  });
  assert.deepEqual(atomic, [[0, doc.indexOf('\n')]]);
});

await test('a setext underline is hidden together with the break above it', () => {
  const doc = 'Title\n=====\n\ntail\n';
  const set = buildRichWidgets(stateOf(doc, doc.length), {});
  const hidden: Array<[number, number]> = [];
  set.decorations.between(0, doc.length, (from, to) => {
    hidden.push([from, to]);
  });
  assert.deepEqual(hidden, [[5, 11]]);
  // A cursor on either line brings the underline back.
  const revealed = buildRichWidgets(stateOf(doc, 2), {});
  let count = 0;
  revealed.decorations.between(0, doc.length, () => {
    count += 1;
  });
  assert.equal(count, 0);
});

await test('the attachment reader accepts only the attachment path', () => {
  assert.equal(attachmentIdOf('/attachments/abc'), 'abc');
  assert.equal(attachmentIdOf('https://example.com/attachments/abc'), null);
  assert.equal(attachmentIdOf('/attachments/abc/extra'), null);
});

await test('an oversized region stays source with a message', () => {
  const widget: RichWidget = {
    from: 0,
    to: 10,
    kind: 'math-display',
    source: '$$\n$$',
    content: 'x'.repeat(richLimits.maxMathChars + 1),
    destination: '',
    block: true,
  };
  assert.equal(shouldPreserveAsSource(widget), true);
  const view = widgetView(
    widget,
    { renderMath: () => '<span></span>' },
    () => false,
  );
  assert.equal(view.kind, 'source');
});

await test('math that throws keeps its source instead of a broken preview', () => {
  const widget: RichWidget = {
    from: 0,
    to: 7,
    kind: 'math-inline',
    source: '$$x^2$$',
    content: 'x^2',
    destination: '',
    block: false,
  };
  const view = widgetView(
    widget,
    {
      renderMath: () => {
        throw new Error('refused');
      },
    },
    () => false,
  );
  assert.equal(view.kind, 'source');
  if (view.kind === 'source') assert.equal(view.source, '$$x^2$$');
});

await test('a missing resolver says so and keeps the source', () => {
  const widget: RichWidget = {
    from: 0,
    to: 7,
    kind: 'math-inline',
    source: '$$x^2$$',
    content: 'x^2',
    destination: '',
    block: false,
  };
  const view = widgetView(widget, {}, () => false);
  assert.equal(view.kind, 'source');
  if (view.kind === 'source') assert.match(view.message, /loading/);
});

await test('an attachment whose bytes are missing keeps its source', () => {
  const doc = `![shot](${attachment})\n`;
  const [region] = findRichRegions(stateOf(doc, doc.length));
  assert.ok(region !== undefined);
  const view = widgetView(
    region,
    { resolveAttachment: () => null },
    () => false,
  );
  assert.equal(view.kind, 'source');
});

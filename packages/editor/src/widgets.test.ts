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

await test('an external picture loads by itself and needs no resolver', () => {
  // Decision 0067. The picture is the content, so it needs no action of the
  // reader and no attachment resolver.
  const doc = '![alt](https://example.invalid/x.png)\n';
  const [region] = findRichRegions(stateOf(doc, 0));
  assert.equal(region?.kind, 'image');
  assert.equal(region?.block, true);
  assert.ok(region !== undefined);
  const view = widgetView(region, {});
  assert.equal(view.kind, 'image');
  if (view.kind === 'image') {
    assert.equal(view.url, 'https://example.invalid/x.png');
    assert.equal(view.external, true);
    assert.equal(view.alt, 'alt');
  }
});

await test('a picture with a refused destination is no region at all', () => {
  // A blocked scheme never becomes a picture, so the source stays on screen
  // exactly as the author wrote it.
  for (const source of [
    '![alt](javascript:alert(1))',
    '![alt](data:image/png;base64,AAAA)',
    '![alt](//example.invalid/x.png)',
  ])
    assert.deepEqual(findRichRegions(stateOf(`${source}\n`, 0)), [], source);
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

await test('a fenced code block hides its opening and closing fence lines', () => {
  const doc = '```js\nconst a = 1;\n```\n\ntail\n';
  const away = buildRichWidgets(stateOf(doc, doc.indexOf('tail')), {});
  const hidden: Array<[number, number]> = [];
  away.decorations.between(0, doc.length, (from, to) => {
    hidden.push([from, to]);
  });
  // The opening line with its trailing break, and the closing line with the
  // break before it.
  assert.deepEqual(hidden, [
    [0, 6],
    [18, 22],
  ]);
  // The code stays between the hidden fences.
  assert.equal(doc.slice(6, 18), 'const a = 1;');
  // A cursor inside the block brings the fences back.
  const inside = buildRichWidgets(stateOf(doc, 8), {});
  let count = 0;
  inside.decorations.between(0, doc.length, () => {
    count += 1;
  });
  assert.equal(count, 0);
});

await test('a mermaid fence renders as a diagram and keeps no fence-line hide', () => {
  const doc = '```mermaid\ngraph TD;\n```\n\ntail\n';
  const away = buildRichWidgets(stateOf(doc, doc.indexOf('tail')), {});
  let count = 0;
  away.decorations.between(0, doc.length, () => {
    count += 1;
  });
  // Only the diagram widget, and no separate fence-line hides.
  assert.equal(count, 1);
});

await test('an unclosed fence hides only its opening line', () => {
  const doc = 'intro\n\n```js\nconst x = 1;\n';
  const away = buildRichWidgets(stateOf(doc, 0), {});
  const hidden: Array<[number, number]> = [];
  away.decorations.between(0, doc.length, (from, to) => {
    hidden.push([from, to]);
  });
  assert.deepEqual(hidden, [[7, 13]]);
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
  const view = widgetView(widget, { renderMath: () => '<span></span>' });
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
  const view = widgetView(widget, {
    renderMath: () => {
      throw new Error('refused');
    },
  });
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
  const view = widgetView(widget, {});
  assert.equal(view.kind, 'source');
  if (view.kind === 'source') assert.match(view.message, /loading/);
});

await test('an attachment whose bytes are missing keeps its source', () => {
  const doc = `![shot](${attachment})\n`;
  const [region] = findRichRegions(stateOf(doc, doc.length));
  assert.ok(region !== undefined);
  const view = widgetView(region, { resolveAttachment: () => null });
  assert.equal(view.kind, 'source');
});

await test('a soft line break joins its paragraph', () => {
  // Decision 0068. The two source lines are one paragraph, so the break
  // between them is replaced by one space and the lines read as one.
  const doc = 'One line.\nJoined to it.\n\nA second paragraph.\n';
  const { decorations } = buildRichWidgets(stateOf(doc, doc.length - 1), {});
  const found: [number, number][] = [];
  decorations.between(0, doc.length, (from, to) => {
    found.push([from, to]);
  });
  assert.deepEqual(found, [[9, 10]]);
  assert.equal(doc.slice(9, 10), '\n');
});

await test('a hard break keeps its line break', () => {
  const doc = 'One line.  \nKept apart.\n';
  const { decorations } = buildRichWidgets(stateOf(doc, doc.length), {});
  const found: [number, number][] = [];
  decorations.between(0, doc.length, (from, to) => {
    found.push([from, to]);
  });
  assert.deepEqual(found, []);
});

await test('a joined paragraph shows its source under the caret', () => {
  const doc = 'One line.\nJoined to it.\n';
  const { decorations } = buildRichWidgets(stateOf(doc, 3), {});
  const found: [number, number][] = [];
  decorations.between(0, doc.length, (from, to) => {
    found.push([from, to]);
  });
  assert.deepEqual(found, []);
});

await test('a joined break swallows the quote mark of the next line', () => {
  // The quote mark of a continuation line is notation, so it goes with the
  // break. Leaving it would put a stray angle bracket inside the sentence.
  const doc = '> One line.\n> Joined to it.\n';
  const { decorations } = buildRichWidgets(stateOf(doc, doc.length), {});
  const found: string[] = [];
  decorations.between(0, doc.length, (from, to) => {
    found.push(doc.slice(from, to));
  });
  assert.deepEqual(found, ['\n> ']);
});

await test('the marker line of an alert keeps its own line', () => {
  // The reference renderer puts the title of an alert in a paragraph of its
  // own, so joining the marker line would run the word into the sentence.
  const doc = '> [!WARNING]\n> Mind the gap.\n> It is wide.\n';
  const { decorations } = buildRichWidgets(stateOf(doc, doc.length), {});
  const found: string[] = [];
  decorations.between(0, doc.length, (from, to) => {
    found.push(doc.slice(from, to));
  });
  // Only the break between the two body lines joins, and it is the one that
  // stands before the second body line.
  assert.deepEqual(found, ['\n> ']);
  let joinedAt = -1;
  buildRichWidgets(stateOf(doc, doc.length), {}).decorations.between(
    0,
    doc.length,
    (from) => {
      joinedAt = from;
    },
  );
  assert.equal(joinedAt, doc.indexOf('\n> It is wide.'));
});

await test('a reference image resolves its destination from the note', () => {
  const doc =
    '![Reference style][img-ref]\n\n[img-ref]: https://example.invalid/a.png\n';
  const [region, ...rest] = findRichRegions(stateOf(doc, doc.length));
  assert.equal(rest.length, 0);
  assert.equal(region?.kind, 'image');
  assert.equal(region?.destination, 'https://example.invalid/a.png');
  assert.equal(region?.content, 'Reference style');
});

await test('a shortcut image reads its own alt text as the label', () => {
  const doc = '![Shortcut]\n\n[shortcut]: https://example.invalid/b.png\n';
  const [region] = findRichRegions(stateOf(doc, doc.length));
  assert.equal(region?.destination, 'https://example.invalid/b.png');
});

await test('a reference image with no definition stays source', () => {
  const doc = '![Missing][nowhere]\n';
  assert.deepEqual(findRichRegions(stateOf(doc, doc.length)), []);
});

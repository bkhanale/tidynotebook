/**
 * The footnote label rule agrees with the renderer (record 0156).
 *
 * The editor reads labels through `footnoteLabelEnd`, and remark reads them
 * through `micromark-extension-gfm-footnote`. Each case writes a reference
 * and a definition with one label and requires that the rule accepts the
 * label exactly when the parse holds a footnote.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Nodes } from 'mdast';
import {
  footnoteIdentifier,
  footnoteLabelEnd,
  footnoteLabelMax,
  footnoteLabelOpen,
} from './footnote-syntax.ts';
import { parseMarkdown } from './parse.ts';

/** The node types of one mdast tree, in document order. */
function typesOf(node: Nodes): readonly string[] {
  const children = 'children' in node ? node.children : [];
  return [node.type, ...children.flatMap((child) => typesOf(child))];
}

/** Whether remark reads a reference and a definition with this label. */
function remarkReads(label: string): boolean {
  const types = typesOf(parseMarkdown(`ref[^${label}]\n\n[^${label}]: def\n`));
  return (
    types.includes('footnoteReference') && types.includes('footnoteDefinition')
  );
}

/** Whether the shared rule reads the whole of `[^label]` as one label. */
function ruleReads(label: string): boolean {
  const text = `${footnoteLabelOpen}${label}]`;
  return footnoteLabelEnd(text, footnoteLabelOpen.length) === text.length - 1;
}

await test('the label rule accepts what remark accepts', () => {
  const cases = [
    'one',
    'A1',
    '1',
    'café',
    '^x',
    'a.b-c_d',
    'a\\]b',
    'a\\[b',
    'a\\\\',
    'x'.repeat(footnoteLabelMax),
    'x'.repeat(footnoteLabelMax + 1),
    'a b',
    'tab\tx',
    'a[b',
    '',
  ];
  for (const label of cases)
    assert.equal(ruleReads(label), remarkReads(label), JSON.stringify(label));
  // The cases hold both answers, so neither side passes by refusing all.
  assert.ok(cases.some((label) => ruleReads(label)));
  assert.ok(cases.some((label) => !ruleReads(label)));
});

await test('a label ends at its first bracket and never crosses a line', () => {
  assert.equal(footnoteLabelEnd('[^one] and [^two]', 2), 5);
  assert.equal(footnoteLabelEnd('[^one', 2), -1);
  assert.equal(footnoteLabelEnd('[^on\ne]', 2), -1);
});

await test('a reference matches its definition in any case', () => {
  assert.equal(footnoteIdentifier('Note'), footnoteIdentifier('NOTE'));
  const types = typesOf(parseMarkdown('ref[^Note]\n\n[^NOTE]: def\n'));
  assert.ok(types.includes('footnoteReference'));
});

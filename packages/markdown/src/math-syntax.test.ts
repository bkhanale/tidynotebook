/**
 * Math delimiter rule checks.
 *
 * The rule is shared by the remark parser in this package and by the live
 * preview parser in `@notesapp/editor`. These tests state the rule once, so a
 * change that breaks one engine breaks this suite first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Nodes } from 'mdast';
import { visit } from 'unist-util-visit';
import {
  closesDollarMath,
  closingDisplayMathFence,
  dollarMathEnd,
  inlineMathDelimiters,
  openingDisplayMathFence,
  opensDollarMath,
  singleDollarTextMath,
} from './math-syntax.ts';
import { parseMarkdown } from './parse.ts';

await test('remark-math reads no single dollar of its own', () => {
  // Its rule is the rule of a code span, which reads `$5 and $10` as a
  // formula, so `math-dollar.ts` reads one dollar instead (record 0170).
  assert.equal(singleDollarTextMath, false);
});

await test('inline math accepts two dollars, the LaTeX parentheses and one dollar', () => {
  assert.deepEqual(
    inlineMathDelimiters.map((pair) => `${pair.open}${pair.close}`),
    ['$$$$', '\\(\\)', '$$'],
  );
});

await test('one dollar opens before a character that is not a space', () => {
  assert.equal(opensDollarMath('', 'x'), true);
  assert.equal(opensDollarMath(' ', '\\'), true);
  assert.equal(opensDollarMath('', ' '), false);
  assert.equal(opensDollarMath('', ''), false);
  assert.equal(opensDollarMath('', '$'), false);
  assert.equal(opensDollarMath('$', 'x'), false);
});

await test('a dollar closes after a character that is not a space and before no digit', () => {
  assert.equal(closesDollarMath('x', ''), true);
  assert.equal(closesDollarMath('x', ' '), true);
  assert.equal(closesDollarMath('x', '.'), true);
  assert.equal(closesDollarMath(' ', ''), false);
  assert.equal(closesDollarMath('x', '1'), false);
});

/** The inline formulas of one line, as `parseMarkdown` reads them. */
function remarkFormulas(text: string): readonly string[] {
  const found: string[] = [];
  visit(parseMarkdown(text), (node: Nodes) => {
    if (node.type === 'inlineMath') found.push(node.value);
  });
  return found;
}

/** The inline formulas of one line, as the scan of the rule reads them. */
function ruleFormulas(text: string): readonly string[] {
  const found: string[] = [];
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (character === '\\') {
      at += 1;
      continue;
    }
    if (character !== '$') continue;
    // A run of two belongs to the `$$` pair, which this rule leaves alone.
    if (text[at + 1] === '$') {
      while (text[at + 1] === '$') at += 1;
      continue;
    }
    const end = dollarMathEnd(text, at);
    if (end === -1) continue;
    found.push(text.slice(at + 1, end));
    at = end;
  }
  return found;
}

/** Lines of prose, each with the formulas that the rule finds in it. */
const dollarCases: readonly (readonly [string, readonly string[]])[] = [
  ['A formula $x^2$ in a sentence.', ['x^2']],
  ['Two $a$ and $b$ formulas.', ['a', 'b']],
  ['It costs $5 and $10 today.', []],
  ['From $5 to $10.', []],
  ['A range of $5-$10 or US$5.', []],
  ['A price $5, then $3 more.', []],
  ['The total $5 and 10$ is math.', ['5 and 10']],
  ['A space $ x$ never opens.', []],
  ['A space $x $ never closes.', []],
  ['A digit $x$1 after the dollar keeps it open.', []],
  ['An escaped \\$x$ is a dollar.', []],
  ['An escape $a\\$b$ inside the formula.', ['a\\$b']],
  ['A closing dollar $a $b$ after a space.', ['a $b']],
  ['A run $$x$ of two opens nothing.', []],
  ['Shell $HOME/$USER reads as Pandoc reads it.', ['HOME/']],
  ['Back to back $a$$b$ formulas.', ['a']],
  ['A lone $ dollar.', []],
  ['Ends with $', []],
];

await test('the scan of the rule finds the formulas that remark finds', () => {
  for (const [text, formulas] of dollarCases) {
    assert.deepEqual(ruleFormulas(text), formulas, `rule: ${text}`);
    assert.deepEqual(remarkFormulas(text), formulas, `remark: ${text}`);
  }
});

await test('two dollars stay the pair of remark-math', () => {
  // The scan of one dollar leaves a run of two alone, and remark-math reads
  // the pair, so a formula in two dollars is one formula on both counts.
  assert.deepEqual(ruleFormulas('Two dollars $$x$$ stay the pair.'), []);
  assert.deepEqual(remarkFormulas('Two dollars $$x$$ stay the pair.'), ['x']);
});

await test('a code span keeps its dollars', () => {
  assert.deepEqual(remarkFormulas('Code `$x$` stays code.'), []);
});

await test('a formula on one dollar ends with its line', () => {
  assert.equal(dollarMathEnd('$a\nb$', 0), -1);
  assert.equal(dollarMathEnd('$a\\\nb$', 0), -1);
  assert.deepEqual(remarkFormulas('Start $a\nb$ end.'), []);
});

await test('a display fence opens on its own line and keeps its info string', () => {
  assert.deepEqual(openingDisplayMathFence('$$'), {
    markFrom: 0,
    markTo: 2,
    infoFrom: 2,
    infoTo: 2,
  });
  assert.deepEqual(openingDisplayMathFence('   $$$ label '), {
    markFrom: 3,
    markTo: 6,
    infoFrom: 7,
    infoTo: 12,
  });
});

await test('a line whose info string holds a dollar is not a display fence', () => {
  // This is what keeps `$$x^2$$` inline math rather than an empty block.
  assert.equal(openingDisplayMathFence('$$x^2$$'), null);
  assert.equal(openingDisplayMathFence('$'), null);
  assert.equal(openingDisplayMathFence('    $$'), null);
});

await test('a closing fence holds only dollars and is long enough', () => {
  assert.equal(closingDisplayMathFence('$$', 2), 2);
  assert.equal(closingDisplayMathFence('$$$  ', 2), 3);
  assert.equal(closingDisplayMathFence('$$', 3), -1);
  assert.equal(closingDisplayMathFence('$$ tail', 2), -1);
});

/**
 * The grid of the icon set, proved without loading JSX.
 *
 * Node loads no `.tsx` file, so the grid itself lives in `./icon-grid.ts` and
 * this test reads `./icons.tsx` as text. That is enough to hold the rule of
 * decision 0065: one viewport, one stroke, and two sizes, stated once and
 * spread by one frame. An icon that stated its own stroke would draw a
 * hairline at 16 px and a heavy mark at 20 px, which is the fault the record
 * answers, and a text read is the only check that can see it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultIconSize, iconAttributes, iconGrid } from './icon-grid.ts';

const iconsSource = readFileSync(
  fileURLToPath(new URL('./icons.tsx', import.meta.url)),
  'utf8',
);
const indexSource = readFileSync(
  fileURLToPath(new URL('./index.ts', import.meta.url)),
  'utf8',
);

/** Every icon that the set draws, in the order the file states them. */
const drawn = [...iconsSource.matchAll(/export function (\w+)\(/g)].map(
  (found) => found[1] ?? '',
);

await test('the grid is one viewport, one stroke and two sizes', () => {
  assert.equal(iconGrid.viewBox, '0 0 24 24');
  assert.equal(iconGrid.strokeWidth, 1.5);
  assert.deepEqual([...iconGrid.sizes], [16, 20]);
  assert.equal(defaultIconSize, 16);
  assert.ok(
    iconGrid.sizes.includes(defaultIconSize),
    'the default size is off the scale',
  );
});

await test('the shared attributes state the grid and hide the glyph', () => {
  assert.equal(iconAttributes.viewBox, iconGrid.viewBox);
  assert.equal(iconAttributes.strokeWidth, iconGrid.strokeWidth);
  assert.equal(iconAttributes.stroke, 'currentColor');
  assert.equal(iconAttributes.fill, 'none');
  assert.equal(iconAttributes.strokeLinecap, 'round');
  assert.equal(iconAttributes.strokeLinejoin, 'round');
  assert.equal(iconAttributes['aria-hidden'], 'true');
});

await test('no icon states a stroke, a viewport or a join of its own', () => {
  for (const attribute of [
    'strokeWidth=',
    'viewBox=',
    'strokeLinecap=',
    'strokeLinejoin=',
    'stroke=',
    'fill=',
    'aria-hidden=',
  ])
    assert.ok(
      !iconsSource.includes(attribute),
      `icons.tsx writes ${attribute} instead of reading the shared grid`,
    );
});

await test('every icon draws in the one frame, exactly once', () => {
  const frames = iconsSource.match(/<IconFrame /g) ?? [];
  assert.equal(frames.length, drawn.length, 'one frame for each icon');
  // The frame is the one element that opens an `svg`, so nothing else can
  // reach the generated document with attributes of its own.
  const roots = iconsSource.match(/<svg /g) ?? [];
  assert.equal(roots.length, 1, 'more than one svg root');
});

await test('every icon of the set is named as an icon and exported', () => {
  const icons = drawn.filter((name) => name !== 'IconFrame');
  assert.ok(icons.length > 20, 'the set is unexpectedly small');
  for (const name of icons) {
    assert.match(name, /Icon$/, `${name} is not named as an icon`);
    assert.ok(
      new RegExp(`^\\s+${name},$`, 'm').test(indexSource),
      `${name} is drawn and never exported`,
    );
  }
  // And nothing is exported that the set does not draw, so a deleted icon
  // cannot leave a dangling name in the public entry point.
  const block = /export \{([^}]*)\} from '\.\/icons\.tsx';/.exec(indexSource);
  assert.ok(block !== null, 'index.ts exports no icon block');
  const exported = (block[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  assert.deepEqual([...exported].sort(), [...icons].sort());
});

await test('the icons that no screen uses are gone', () => {
  // Decision 0065 deletes an icon that no screen uses. These six were
  // exported and never rendered.
  for (const name of [
    'PanelRightIcon',
    'CloudOffIcon',
    'ImageIcon',
    'CloudCheckIcon',
    'CloudUploadIcon',
    'UserIcon',
  ]) {
    assert.ok(!drawn.includes(name), `${name} is still drawn`);
    assert.ok(!indexSource.includes(name), `${name} is still exported`);
  }
});

await test('every drawn coordinate stays inside the grid', () => {
  // A path drawn outside the viewport is clipped, so the glyph reads as a
  // different shape at one size than at the other.
  for (const [, value] of iconsSource.matchAll(
    /(?:points|x1|y1|x2|y2|cx|cy|x|y)="([\d. ]+)"/g,
  )) {
    for (const part of (value ?? '').split(' ')) {
      if (part === '') continue;
      const number = Number(part);
      assert.ok(!Number.isNaN(number), part);
      assert.ok(number >= 0 && number <= 24, `${part} is off the 24 grid`);
    }
  }
});

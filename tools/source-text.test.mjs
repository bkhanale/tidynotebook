import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { root } from './workspace.mjs';
import {
  arrowDownParts,
  arrowUpParts,
  checkParts,
  closeParts,
  copyParts,
  plusParts,
} from '../packages/ui/src/glyph-parts.ts';

await test('the folder dialogs are stored as reviewable text', async () => {
  const source = await readFile(
    resolve(root, 'apps/web/src/features/folders/folders.tsx'),
  );
  assert.equal(source.includes(0), false);
});

/**
 * The JSX of one glyph part, as `packages/ui/src/icons.tsx` writes it.
 *
 * @param {import('../packages/ui/src/glyph-parts.ts').GlyphPart} part
 * @returns {string}
 */
function partSource(part) {
  switch (part.kind) {
    case 'path':
      return `<path d="${part.d}" />`;
    case 'polyline':
      return `<polyline points="${part.points}" />`;
    case 'line':
      return `<line x1="${String(part.x1)}" y1="${String(part.y1)}" x2="${String(part.x2)}" y2="${String(part.y2)}" />`;
    case 'rect':
      return `<rect x="${String(part.x)}" y="${String(part.y)}" width="${String(part.width)}" height="${String(part.height)}" rx="${String(part.rx)}" ry="${String(part.rx)}" />`;
    default:
      return `<circle cx="${String(part.cx)}" cy="${String(part.cy)}" r="${String(part.r)}" />`;
  }
}

await test('each glyph of plain DOM draws the parts of its icon', async () => {
  // The editor and the script of a published page draw these glyphs with no
  // React, so `packages/ui/src/glyph.ts` holds them beside the icon set and
  // this test holds the two to one shape.
  const icons = await readFile(
    resolve(root, 'packages/ui/src/icons.tsx'),
    'utf8',
  );
  /** @type {readonly (readonly [string, readonly import('../packages/ui/src/glyph-parts.ts').GlyphPart[]])[]} */
  const glyphs = [
    ['PlusIcon', plusParts],
    ['CopyIcon', copyParts],
    ['CheckIcon', checkParts],
    ['CloseIcon', closeParts],
    ['ArrowUpIcon', arrowUpParts],
    ['ArrowDownIcon', arrowDownParts],
  ];
  for (const [name, parts] of glyphs) {
    const start = icons.indexOf(`export function ${name}(`);
    assert.notEqual(start, -1, name);
    const source = icons.slice(start, icons.indexOf('\n}\n', start));
    for (const part of parts)
      assert.ok(source.includes(partSource(part)), `${name}: ${partSource(part)}`);
    assert.equal(source.split('/>').length - 1, parts.length, name);
  }
});

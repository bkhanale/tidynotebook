/** The official notebook icons use Default colours and launcher padding. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { defaultThemeFor } from '@notesapp/ui';
import { appIcons } from '../../apps/web/src/pwa/icons.ts';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const iconDirectory = resolve(root, 'apps/web/icons');

/** The side of the round tile of `icon.svg`, on its 512 grid. */
const tileSide = 480;

/** The part of the tile that the page spans at the least. */
const smallestMarkSpan = 0.65;

/**
 * The radius of the circle that a launcher never cuts, as a part of the side.
 * See https://w3c.github.io/manifest/#icon-masks.
 */
const safeRadius = 0.4;

/** The pixels of a raster, with a way to read one of them. */
async function pixels(file: string): Promise<{
  readonly width: number;
  readonly height: number;
  readonly at: (x: number, y: number) => readonly number[];
}> {
  const { data, info } = await sharp(resolve(iconDirectory, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    at: (x, y) => {
      const start = (y * info.width + x) * info.channels;
      return [...data.subarray(start, start + info.channels)];
    },
  };
}

/** Whether a pixel is part of the light page, not the dark tile. */
function isMark(pixel: readonly number[]): boolean {
  return (pixel[0] ?? 0) > 128 && (pixel[3] ?? 0) > 128;
}

/** Each pixel of the page of a raster, as its column and row. */
async function markPixels(file: string): Promise<{
  readonly side: number;
  readonly points: readonly (readonly [number, number])[];
}> {
  const raster = await pixels(file);
  const points: [number, number][] = [];
  for (let y = 0; y < raster.height; y += 1)
    for (let x = 0; x < raster.width; x += 1)
      if (isMark(raster.at(x, y))) points.push([x, y]);
  return { side: raster.width, points };
}

await test('the install icon names the product and paints theme colours', async () => {
  const icon = await readFile(resolve(iconDirectory, 'icon.svg'), 'utf8');
  assert.match(icon, /<title>tidy notebook install icon<\/title>/);

  const tokens = new Set(
    (['light', 'dark'] as const).flatMap((appearance) =>
      Object.values(defaultThemeFor(appearance).tokens).map((value) =>
        value.toLowerCase(),
      ),
    ),
  );
  // The comment names the tokens. Only the drawing paints.
  const drawing = icon.replace(/<!--[\s\S]*?-->/g, '');
  const painted = [...drawing.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map(
    ([, value = '']) => value.toLowerCase(),
  );
  assert.ok(painted.length > 0, 'the install icon paints nothing');
  for (const value of painted)
    assert.ok(
      value === 'none' || tokens.has(value),
      `${value} is not a Default theme token`,
    );
});

await test('each raster has its size and the right corners', async () => {
  const fullSquare = new Set(['maskable-512.png', 'apple-touch-icon.png']);
  for (const icon of appIcons) {
    if (icon.type !== 'image/png') continue;
    const raster = await pixels(icon.file);
    assert.equal(
      `${String(raster.width)}x${String(raster.height)}`,
      icon.sizes,
      icon.file,
    );
    // A launcher that cuts its own shape shows a clear corner as a hole.
    assert.equal(
      raster.at(0, 0)[3],
      fullSquare.has(icon.file) ? 255 : 0,
      `${icon.file} has the wrong corner`,
    );
  }
});

await test('the mark fills most of the tile', async () => {
  const { side, points } = await markPixels('icon-512.png');
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  const tile = (tileSide / 512) * side;
  assert.ok(
    span >= smallestMarkSpan * tile,
    `the mark spans ${String(span)} of a tile of ${String(tile)} pixels`,
  );
});

await test('the maskable mark stays inside the safe circle', async () => {
  const { side, points } = await markPixels('maskable-512.png');
  assert.ok(points.length > 0, 'the maskable icon draws no mark');
  const centre = side / 2;
  for (const [x, y] of points)
    assert.ok(
      Math.hypot(x + 0.5 - centre, y + 0.5 - centre) <= safeRadius * side,
      `the pixel at ${String(x)}, ${String(y)} leaves the safe circle`,
    );
});

await test('the ICO directory names three complete PNG frames', async () => {
  const ico = await readFile(resolve(iconDirectory, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  let offset = 54;
  for (const [index, side] of [16, 32, 48].entries()) {
    const at = 6 + index * 16;
    assert.equal(ico[at], side);
    assert.equal(ico[at + 1], side);
    assert.equal(ico.readUInt16LE(at + 4), 1);
    assert.equal(ico.readUInt16LE(at + 6), 32);
    assert.equal(ico.readUInt32LE(at + 12), offset);
    const length = ico.readUInt32LE(at + 8);
    const frame = await sharp(ico.subarray(offset, offset + length)).metadata();
    assert.equal(frame.width, side);
    assert.equal(frame.height, side);
    offset += length;
  }
  assert.equal(offset, ico.length);
});

await test('the SVG favicon has a stroke for each device preference', async () => {
  const svg = await readFile(resolve(iconDirectory, 'icon.svg'), 'utf8');
  const light = defaultThemeFor('light').tokens.textStrong;
  const dark = defaultThemeFor('dark').tokens.textStrong;
  assert.ok(svg.includes(`g{stroke:${light}}`));
  assert.ok(
    svg.includes(`@media(prefers-color-scheme:dark){g{stroke:${dark}}}`),
  );
});

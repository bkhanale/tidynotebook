import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { compareIconAsset } from './generate-icons.mjs';
import { root } from './workspace.mjs';

/** @param {number} value @param {number} [compressionLevel] */
const png = (value, compressionLevel = 9) =>
  sharp(Buffer.from([value, 80, 90, 255]), {
    raw: { width: 1, height: 1, channels: 4 },
  })
    .png({ compressionLevel })
    .toBuffer();

await test('PNG comparison permits encoding changes and one channel level only', async () => {
  const expected = await png(70);
  const uncompressed = await png(70, 0);
  assert.ok(!uncompressed.equals(expected));
  await compareIconAsset('icon.png', expected, uncompressed);
  await compareIconAsset('icon.png', expected, await png(71));
  await compareIconAsset('icon.png', expected, await png(69));
  await assert.rejects(
    compareIconAsset('icon.png', expected, await png(72)),
    /pixels differ/,
  );
  const larger = await sharp(expected).resize(2, 2).png().toBuffer();
  await assert.rejects(
    compareIconAsset('icon.png', expected, larger),
    /image shape differs/,
  );
});

await test('SVG comparison stays byte exact', async () => {
  await assert.rejects(
    compareIconAsset('icon.svg', Buffer.from('<svg/>'), Buffer.from('<svg />')),
    /is stale/,
  );
});

await test('ICO comparison permits PNG encoding changes but checks every directory field', async () => {
  const expected = await readFile(resolve(root, 'apps/web/icons/favicon.ico'));
  const header = Buffer.from(expected.subarray(0, 54));
  const frames = [];
  let offset = header.length;
  for (let index = 0; index < 3; index++) {
    const at = 6 + index * 16;
    const start = expected.readUInt32LE(at + 12);
    const length = expected.readUInt32LE(at + 8);
    const frame = await sharp(expected.subarray(start, start + length))
      .png({ compressionLevel: 0 })
      .toBuffer();
    header.writeUInt32LE(frame.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += frame.length;
    frames.push(frame);
  }
  const actual = Buffer.concat([header, ...frames]);
  assert.ok(!actual.equals(expected));
  await compareIconAsset('favicon.ico', expected, actual);
  for (const at of [0, 2, 4, 6, 8, 10, 12, 22, 38]) {
    const changed = Buffer.from(actual);
    changed[at] = (changed[at] ?? 0) ^ 1;
    await assert.rejects(compareIconAsset('favicon.ico', expected, changed));
  }
  const gap = Buffer.from(actual);
  gap.writeUInt32LE(55, 18);
  await assert.rejects(
    compareIconAsset('favicon.ico', expected, gap),
    /frame offset differs/,
  );
  await assert.rejects(
    compareIconAsset('favicon.ico', expected, actual.subarray(0, 30)),
    /truncated ICO directory/,
  );
  await assert.rejects(
    compareIconAsset(
      'favicon.ico',
      expected,
      Buffer.concat([actual, Buffer.from([0])]),
    ),
    /extra ICO bytes/,
  );
});

await test('the default email logo keeps its own dark tile and light mark without a media query', async () => {
  const { emailLogoImages } =
    await import('../apps/server/src/auth/email-logo.ts');
  const image = emailLogoImages.find(
    (value) => value.filename === 'notebook-light.png',
  );
  assert.ok(image);
  const { data, info } = await sharp(Buffer.from(image.content, 'base64'))
    .resize(32, 32)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  let dark = 0,
    light = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] !== 255) continue;
    const red = data[index] ?? 0,
      green = data[index + 1] ?? 0,
      blue = data[index + 2] ?? 0;
    if (Math.max(red, green, blue) < 40) dark++;
    if (Math.min(red, green, blue) > 220) light++;
  }
  assert.ok(dark > 200, 'opaque tile under the mark');
  assert.ok(light > 50, 'light strokes inside the opaque tile');
});

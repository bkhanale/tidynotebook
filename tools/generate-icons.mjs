/** Generate the official mark assets. --check compares without writing. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { format, resolveConfig } from 'prettier';
import { root } from './workspace.mjs';

/** Compare decoded channels, allowing one level of raster rounding. */
/** @param {Buffer} expected @param {Buffer} actual @param {string} path */
async function comparePixels(expected, actual, path) {
  const decode = (/** @type {Buffer} */ bytes) =>
    sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [wanted, found] = await Promise.all([decode(expected), decode(actual)]);
  assert.deepEqual(found.info, wanted.info, `${path}: image shape differs`);
  assert.ok(
    found.data.every(
      (value, index) => Math.abs(value - (wanted.data[index] ?? Infinity)) <= 1,
    ),
    `${path}: pixels differ. Run node tools/generate-icons.mjs.`,
  );
}

/** Exact text and ICO structure; raster channels permit rounding by one. */
/** @param {string} path @param {Buffer} expected @param {Buffer} actual */
export async function compareIconAsset(path, expected, actual) {
  if (path.endsWith('.png')) return comparePixels(expected, actual, path);
  if (path.endsWith('.ico')) {
    assert.ok(actual.length >= 6, `${path}: truncated ICO header`);
    assert.ok(
      actual.subarray(0, 6).equals(expected.subarray(0, 6)),
      `${path}: ICO header differs`,
    );
    const count = expected.readUInt16LE(4);
    let offset = 6 + count * 16;
    assert.ok(actual.length >= offset, `${path}: truncated ICO directory`);
    for (let index = 0; index < count; index++) {
      const at = 6 + index * 16;
      assert.ok(
        actual.subarray(at, at + 8).equals(expected.subarray(at, at + 8)),
        `${path}: ICO frame fields differ`,
      );
      const length = actual.readUInt32LE(at + 8);
      assert.equal(
        actual.readUInt32LE(at + 12),
        offset,
        `${path}: ICO frame offset differs`,
      );
      assert.ok(
        length > 0 && offset + length <= actual.length,
        `${path}: invalid ICO frame length`,
      );
      const expectedOffset = expected.readUInt32LE(at + 12);
      const expectedLength = expected.readUInt32LE(at + 8);
      const frame = actual.subarray(offset, offset + length);
      assert.ok(
        frame
          .subarray(0, 8)
          .equals(expected.subarray(expectedOffset, expectedOffset + 8)),
        `${path}: ICO frame is not PNG`,
      );
      await comparePixels(
        expected.subarray(expectedOffset, expectedOffset + expectedLength),
        frame,
        path,
      );
      offset += length;
    }
    assert.equal(actual.length, offset, `${path}: extra ICO bytes`);
    return;
  }
  assert.ok(
    actual.equals(expected),
    `${path} is stale. Run node tools/generate-icons.mjs.`,
  );
}

/** Rebuild each asset in memory, then write or compare it. */
export async function generateIcons(check = false) {
  /** @param {string} path */
  const read = (path) => readFile(resolve(root, path), 'utf8');
  const canonical = await read('packages/ui/assets/notebook.svg');
  /** @param {string} text */
  const paths = (text) =>
    [...text.matchAll(/<path[^>]+\/>/g)].map(([path]) => path).join('\n');
  const component =
    (await read('packages/ui/src/icons.tsx'))
      .split('export function AppMarkIcon')[1]
      ?.split('</IconFrame>')[0] ?? '';
  assert.equal(
    paths(component),
    paths(canonical),
    'AppMarkIcon must match the canonical notebook',
  );
  const theme = await read('packages/ui/src/themes/default.ts');
  const strong = [...theme.matchAll(/textStrong: '([^']+)'/g)].map(
    (match) => match[1],
  );
  const light = strong[0];
  const dark = strong[1];
  const fill = /accentFill: '([^']+)'/.exec(theme)?.[1];
  assert.ok(light && dark && fill);
  const geometry = paths(canonical);
  /** @param {string} stroke */
  const group = (stroke) =>
    `<g fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${geometry}</g>`;
  /** @param {number} side @param {string} body */
  const svg = (side, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 24 24"><title>tidy notebook install icon</title>${body}</svg>\n`;
  const favicon = svg(
    24,
    `<style>g{stroke:${light}}@media(prefers-color-scheme:dark){g{stroke:${dark}}}</style>${group(light)}`,
  );
  /** @param {number} side */
  const tile = (side, maskable = false, square = false) =>
    svg(
      side,
      `<rect width="24" height="24" rx="${square ? 0 : 5}" fill="${fill}"/><g transform="translate(${maskable ? '4.8 4.8' : '1.2 1.2'}) scale(${maskable ? '0.6' : '0.9'})">${group(dark)}</g>`,
    );
  const outputs = new Map([['apps/web/icons/icon.svg', Buffer.from(favicon)]]);
  const emailImages = [];
  for (const { appearance, stroke } of [
    { appearance: 'light', stroke: light },
    { appearance: 'dark', stroke: dark },
  ]) {
    // The opaque official tile stays visible if a client cannot switch logos.
    const bytes = await sharp(
      Buffer.from(appearance === 'light' ? tile(64) : svg(64, group(stroke))),
    )
      .png()
      .toBuffer();
    emailImages.push(
      `  { filename: 'notebook-${appearance}.png', cid: emailLogoCids.${appearance}, contentType: 'image/png', encoding: 'base64', contentDisposition: 'inline', content: '${bytes.toString('base64')}' },`,
    );
  }
  outputs.set(
    'apps/server/src/auth/email-logo.ts',
    Buffer.from(
      await format(
        `// Generated by tools/generate-icons.mjs from the official notebook mark.\n` +
          `import type { MailInlineImage } from './mail.ts';\n\n` +
          `export const emailLogoCids = { light: 'notebook-light@notesapp', dark: 'notebook-dark@notesapp' } as const;\n\n` +
          `export const emailLogoImages: readonly MailInlineImage[] = [\n${emailImages.join('\n')}\n];\n`,
        {
          ...(await resolveConfig(
            resolve(root, 'apps/server/src/auth/email-logo.ts'),
          )),
          parser: 'typescript',
        },
      ),
    ),
  );

  /** @type {readonly (readonly [string, number, boolean, boolean])[]} */
  const rasters = [
    ['apple-touch-icon.png', 180, false, true],
    ['icon-192.png', 192, false, false],
    ['icon-512.png', 512, false, false],
    ['maskable-512.png', 512, true, true],
  ];
  for (const [file, side, maskable, square] of rasters)
    outputs.set(
      `apps/web/icons/${file}`,
      await sharp(Buffer.from(tile(side, maskable, square)))
        .png()
        .toBuffer(),
    );
  const frames = [];
  for (const side of [16, 32, 48])
    frames.push(
      await sharp(Buffer.from(tile(side)))
        .png()
        .toBuffer(),
    );
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  for (const [index, frame] of frames.entries()) {
    const at = 6 + index * 16;
    const side = [16, 32, 48][index];
    assert.ok(side !== undefined);
    header[at] = side;
    header[at + 1] = side;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(frame.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += frame.length;
  }
  outputs.set('apps/web/icons/favicon.ico', Buffer.concat([header, ...frames]));
  const cardPath =
    'docs/design/028-emails-and-link-previews/social-card-light.svg';
  const card = (await read(cardPath)).replace(
    /<!-- notebook:start -->[\s\S]*?<!-- notebook:end -->/,
    `<!-- notebook:start -->\n<g transform="translate(528 128) scale(6)">${tile(
      24,
    )
      .replace(/^[\s\S]*?<title>[^<]*<\/title>/, '')
      .replace(/<\/svg>\s*$/, '')}</g>\n<!-- notebook:end -->`,
  );
  outputs.set(cardPath, Buffer.from(card));
  const png = await sharp(Buffer.from(card)).png().toBuffer();
  outputs.set('apps/web/icons/social-card.png', png);
  outputs.set(
    'docs/design/028-emails-and-link-previews/social-card-light.png',
    png,
  );
  for (const [path, bytes] of outputs) {
    if (check)
      await compareIconAsset(path, bytes, await readFile(resolve(root, path)));
    else await writeFile(resolve(root, path), bytes);
  }
}

if (import.meta.main) await generateIcons(process.argv.includes('--check'));

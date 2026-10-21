/** Generate the official mark assets. --check compares without writing. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { root } from './workspace.mjs';

/** Rebuild each asset in memory, then write or compare its exact bytes. */
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
      assert.ok(
        bytes.equals(await readFile(resolve(root, path))),
        `${path} is stale. Run node tools/generate-icons.mjs.`,
      );
    else await writeFile(resolve(root, path), bytes);
  }
}

if (import.meta.main) await generateIcons(process.argv.includes('--check'));

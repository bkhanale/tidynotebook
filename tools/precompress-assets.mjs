/**
 * Writes the precompressed neighbours of the built browser assets.
 *
 * The server serves `name.ext.br` or `name.ext.gz` when the browser accepts
 * that encoding, so compression happens once at build time instead of on
 * every request. Only `node:zlib` is used, so this step adds no dependency.
 *
 * Usage: node tools/precompress-assets.mjs <directory>
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compressGzip = promisify(gzip);
const compressBrotli = promisify(brotliCompress);

/**
 * Extensions worth compressing. Everything else is already compressed, or is
 * never requested by a browser. A `.map` file is emitted but not referenced,
 * because the build uses hidden source maps, so it is left uncompressed.
 */
const compressible = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
]);

/** Below this size the header cost outweighs the saving. */
const minimumBytes = 1024;

/** Names that hold a compressed result already. */
const generated = /\.(?:br|gz)$/;

/** @param {string} directory @returns {Promise<string[]>} */
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return filesIn(path);
      return entry.isFile() ? [path] : [];
    }),
  );
  return found.flat();
}

/** @param {string} file @returns {string} */
const extensionOf = (file) => {
  const index = file.lastIndexOf('.');
  return index === -1 ? '' : file.slice(index).toLowerCase();
};

const directory = process.argv[2];
if (directory === undefined) {
  console.error('Usage: node tools/precompress-assets.mjs <directory>');
  process.exit(1);
}

const files = (await filesIn(directory)).filter(
  (file) => !generated.test(file) && compressible.has(extensionOf(file)),
);

let originalBytes = 0;
let brotliBytes = 0;
let gzipBytes = 0;
let written = 0;

for (const file of files) {
  const source = await readFile(file);
  if (source.byteLength < minimumBytes) continue;
  const brotli = await compressBrotli(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
    },
  });
  const gzipped = await compressGzip(source, { level: 9 });
  originalBytes += source.byteLength;
  brotliBytes += brotli.byteLength;
  gzipBytes += gzipped.byteLength;
  // A variant that is not smaller would only cost the browser time. Each one
  // is written after the file it describes, so its modification time is never
  // earlier and the server never rejects it as stale.
  if (brotli.byteLength < source.byteLength) {
    await writeFile(`${file}.br`, brotli);
    written += 1;
  }
  if (gzipped.byteLength < source.byteLength) {
    await writeFile(`${file}.gz`, gzipped);
    written += 1;
  }
}

const kib = (/** @type {number} */ bytes) => `${(bytes / 1024).toFixed(0)} KiB`;
console.log(
  `precompress: ${String(written)} files written for ${String(files.length)} assets; ` +
    `${kib(originalBytes)} raw, ${kib(brotliBytes)} brotli, ${kib(gzipBytes)} gzip`,
);

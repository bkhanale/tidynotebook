/** Keep the exact preferred source, build scripts and patches of libvips. */
import { createHash } from 'node:crypto';
import { get } from 'node:https';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, record, root } from './workspace.mjs';

/** @param {Uint8Array} bytes @param {string} expected */
export function sourceMatches(bytes, expected) {
  return createHash('sha256').update(bytes).digest('hex') === expected;
}

/** @param {unknown} value @returns {{file:string, url:string, sha256:string}[]} */
export function sourceRows(value) {
  if (!Array.isArray(value))
    throw new Error('The native source list is missing.');
  /** @type {Set<string>} */
  const files = new Set();
  return value.map((value) => {
    const row = record(value);
    if (
      typeof row.file !== 'string' ||
      !/^[\w.+~-]+$/.test(row.file) ||
      ['.', '..', 'manifest.json'].includes(row.file) ||
      files.has(row.file) ||
      typeof row.url !== 'string' ||
      !row.url.startsWith('https://') ||
      typeof row.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.sha256)
    )
      throw new Error('A native source row is invalid.');
    files.add(row.file);
    return { file: row.file, url: row.url, sha256: row.sha256 };
  });
}

/** @param {string} url @param {number} [redirects] @returns {Promise<Uint8Array>} */
async function sourceBytes(url, redirects = 0) {
  if (!url.startsWith('https://') || redirects > 8)
    throw new Error('A native source redirect is invalid.');
  /** @type {import('node:http').IncomingMessage} */
  const response = await new Promise((resolve, reject) => {
    get(
      url,
      { headers: { 'User-Agent': 'tidy-notebook-source-builder' } },
      resolve,
    ).on('error', reject);
  });
  if (
    response.statusCode !== undefined &&
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    response.headers.location !== undefined
  ) {
    response.resume();
    return sourceBytes(
      new URL(response.headers.location, url).href,
      redirects + 1,
    );
  }
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(
      `The native source download fails (${response.statusCode}): ${url}.`,
    );
  }
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** @param {string} output @param {string} [cache] @param {string} [manifestFile] */
export async function prepareNativeSources(
  output,
  cache,
  manifestFile = join(root, 'tools/native-sources.json'),
) {
  const manifest = await readJson(manifestFile);
  const rows = sourceRows(manifest.sources);
  await mkdir(output, { recursive: true });
  /** @param {{file:string, url:string, sha256:string}} row */
  async function download(row) {
    let bytes;
    if (cache !== undefined) bytes = await readFile(join(cache, row.file));
    else bytes = await sourceBytes(row.url);
    if (!sourceMatches(bytes, row.sha256))
      throw new Error(`The native source hash differs: ${row.file}.`);
    const temporary = join(output, `${row.file}.partial`);
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, join(output, row.file));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  for (let offset = 0; offset < rows.length; offset += 6)
    await Promise.all(rows.slice(offset, offset + 6).map(download));
  await writeFile(
    join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const output = process.argv[2];
  if (output === undefined) throw new Error('Give the native source folder.');
  await prepareNativeSources(
    resolve(output),
    process.argv[3] || undefined,
    process.argv[4],
  );
}

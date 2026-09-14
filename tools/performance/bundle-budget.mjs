/** Enforces the compressed JavaScript budget of the built initial page. */
import { gzipSync } from 'node:zlib';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = resolve(root, 'apps/web/dist/web');
const htmlPath = join(dist, 'index.html');
const budgetBytes = 250 * 1024;
const html = await readFile(htmlPath, 'utf8');
const references = new Set();
for (const match of html.matchAll(
  /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+[.]js)["'][^>]*>/g,
)) {
  const value = match[1];
  if (value !== undefined) references.add(value);
}
if (references.size === 0)
  throw new Error('The built index has no initial JavaScript references.');

const files = [];
let gzipBytes = 0;
const realDist = await realpath(dist);
for (const reference of [...references].sort((left, right) =>
  left.localeCompare(right),
)) {
  const file = resolve(dist, reference.replace(/^\//, ''));
  const realFile = await realpath(file);
  if (realFile !== realDist && !realFile.startsWith(`${realDist}${sep}`))
    throw new Error('An initial JavaScript reference leaves the build root.');
  const bytes = await readFile(realFile);
  const compressed = gzipSync(bytes, { level: 9 }).byteLength;
  gzipBytes += compressed;
  files.push({ file: relative(dist, realFile), gzipBytes: compressed });
}

const report = {
  environment: {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  },
  sample:
    'JavaScript referenced by script and modulepreload tags in index.html',
  files,
  gzipBytes,
  budgetBytes,
  status: gzipBytes <= budgetBytes ? 'pass' : 'fail',
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status === 'fail') process.exitCode = 1;

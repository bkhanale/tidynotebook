/**
 * Reports what the HTTP contract costs at server startup.
 *
 * Loading `@notesapp/api-contract` compiles one Ajv validator for every
 * request slot and every declared response of the contract. That work happens
 * once, before the server can accept traffic, so it is the startup cost of the
 * boundary. The script runs the load in a fresh child process each time, so no
 * module cache carries between samples, and it reports the median.
 *
 * Usage: `node tools/performance/contract-startup.mjs [samples]`
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entry = resolve(root, 'packages/api-contract/src/index.ts');
const samples = Number(process.argv[2] ?? '7');
if (!Number.isInteger(samples) || samples < 1)
  throw new Error('The sample count must be a positive whole number.');

const child = `
const started = process.hrtime.bigint();
await import(${JSON.stringify(entry)});
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
process.stdout.write(
  JSON.stringify({ elapsedMs, rssBytes: process.memoryUsage().rss }),
);
`;

/**
 * The middle value of a sorted copy of the samples.
 *
 * @param {readonly number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** @type {number[]} */
const times = [];
/** @type {number[]} */
const resident = [];
for (let run = 0; run < samples; run += 1) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', child],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0)
    throw new Error(`Sample ${String(run + 1)} failed: ${result.stderr}`);
  const measured = /** @type {Record<string, unknown>} */ (
    JSON.parse(result.stdout)
  );
  times.push(Number(measured.elapsedMs));
  resident.push(Number(measured.rssBytes));
}

console.log(
  [
    `samples: ${String(samples)}`,
    `load: ${median(times).toFixed(1)} ms (median)`,
    `rss: ${(median(resident) / 1024 / 1024).toFixed(1)} MB (median)`,
  ].join('\n'),
);

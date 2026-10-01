import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  areaReadingList,
  coreReadingList,
  keyFiles,
} from './agent-context.mjs';

// The fixtures below are disposable trees under the system temporary
// directory. They are never committed as application code.
const script = fileURLToPath(new URL('./agent-context.mjs', import.meta.url));

const guide = `# packages/core

## Key files

| File            | Purpose          |
| --------------- | ---------------- |
| \`src/index.ts\`  | The public entry |
| \`src/model.ts\`  | The domain model |
`;

/**
 * @param {Record<string, string>} overrides
 * @param {string[]} paths
 * @returns {{ status: number; output: string }}
 */
function run(overrides, paths) {
  const directory = mkdtempSync(join(tmpdir(), 'notesapp-context-'));
  try {
    /** @type {Record<string, string>} */
    const files = { 'packages/core/AGENTS.md': guide };
    for (const [file] of coreReadingList) files[file] = '# Fixture\n';
    for (const name of ['src/index.ts', 'src/model.ts'])
      files[`packages/core/${name}`] = 'export {};\n';
    files['apps/web/AGENTS.md'] = '# apps/web\n';
    for (const [, file] of areaReadingList) files[file] = '# Fixture\n';
    for (const [name, content] of Object.entries({ ...files, ...overrides })) {
      if (content === '') continue;
      const file = join(directory, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    const result = spawnSync(
      process.execPath,
      [script, '--root', directory, ...paths],
      { encoding: 'utf8' },
    );
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await test('the key files table gives one row per pointed at file', () => {
  assert.deepEqual(keyFiles(guide), [
    { path: 'src/index.ts', purpose: 'The public entry' },
    { path: 'src/model.ts', purpose: 'The domain model' },
  ]);
});

await test('a text with no key files section gives no row', () => {
  assert.deepEqual(keyFiles('# apps/web\n\n## Purpose\n\n| a | b |\n'), []);
});

await test('a path lists the core files, its guide, then the key files', () => {
  const result = run({}, ['packages/core/src/model.ts']);
  assert.equal(result.status, 0, result.output);
  const listed = result.output
    .split('\n')
    .filter((line) => /^ {2}\d+\. /.test(line))
    .map((line) => line.replace(/^ {2}\d+\. /, '').split(':')[0]);
  assert.deepEqual(listed, [
    ...coreReadingList.map(([file]) => file),
    'packages/core/AGENTS.md',
    'packages/core/src/index.ts',
    'packages/core/src/model.ts',
  ]);
});

await test('a path under an area lists the guide of that area', () => {
  const result = run({}, ['apps/web/src/features/notes/notes-home.tsx']);
  assert.equal(result.status, 0, result.output);
  const listed = result.output
    .split('\n')
    .filter((line) => /^ {2}\d+\. /.test(line))
    .map((line) => line.replace(/^ {2}\d+\. /, '').split(':')[0]);
  assert.deepEqual(listed, [
    ...coreReadingList.map(([file]) => file),
    'docs/development/design.md',
    'apps/web/AGENTS.md',
  ]);
});

await test('a path of the documentation site lists the design guide', () => {
  const result = run({}, ['apps/docs/src/page.ts']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /docs\/development\/design\.md/);
});

await test('a path outside every area lists no area guide', () => {
  const result = run({}, ['packages/core/src/model.ts']);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /docs\/development\/design\.md/);
});

await test('no path lists every nested guide', () => {
  const result = run({}, []);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /apps\/web\/AGENTS\.md/);
  assert.match(result.output, /packages\/core\/AGENTS\.md/);
});

await test('a guide that points at a missing file fails', () => {
  const result = run({ 'packages/core/src/model.ts': '' }, ['packages/core']);
  assert.equal(result.status, 1);
  assert.match(result.output, /packages\/core\/src\/model\.ts/);
});

await test('a missing core file fails', () => {
  const result = run({ 'docs/decisions/README.md': '' }, ['packages/core']);
  assert.equal(result.status, 1);
  assert.match(result.output, /docs\/decisions\/README\.md/);
});

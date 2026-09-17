import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  jsxTextRule,
  motionModule,
  scanSource,
  textRules,
} from './check-design-rules.mjs';

// The fixtures below are disposable trees under the system temporary
// directory. They are never committed as application code.
const checker = fileURLToPath(
  new URL('./check-design-rules.mjs', import.meta.url),
);

/**
 * @param {Record<string, string>} files
 * @returns {{ status: number; output: string }}
 */
function check(files) {
  const directory = mkdtempSync(join(tmpdir(), 'notesapp-design-'));
  try {
    mkdirSync(join(directory, 'apps/web/src'), { recursive: true });
    mkdirSync(join(directory, 'packages/ui/src'), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const file = join(directory, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    const result = spawnSync(process.execPath, [checker, '--root', directory], {
      encoding: 'utf8',
    });
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** @param {string} source @returns {string[]} */
const rulesOf = (source) =>
  scanSource('apps/web/src/screen.tsx', source).map((issue) => issue.rule);

await test('a colour value outside the theme registry fails', () => {
  assert.equal(
    textRules['colour-literal']('#1a1b26', 'apps/web/src/screen.tsx'),
    'Colour value #1a1b26 outside the theme registry.',
  );
  assert.equal(
    textRules['colour-literal']('rgb(10, 20, 30)', 'apps/web/src/screen.tsx'),
    'Colour value rgb( outside the theme registry.',
  );
});

await test('the theme registry may hold a colour value', () => {
  assert.equal(
    textRules['colour-literal']('#1a1b26', 'packages/ui/src/themes/nord.ts'),
    null,
  );
});

await test('a Tailwind arbitrary value fails and a selector does not', () => {
  assert.notEqual(textRules['arbitrary-value']('w-[32rem] p-2'), null);
  assert.notEqual(textRules['arbitrary-value']('grid-cols-[1fr_auto]'), null);
  assert.equal(textRules['arbitrary-value']('[role="menuitem"]'), null);
  assert.equal(textRules['arbitrary-value']('flex items-center gap-2'), null);
});

await test('a class outside the named scale fails', () => {
  assert.notEqual(textRules['banned-class']('flex text-xs'), null);
  assert.notEqual(textRules['banned-class']('text-white'), null);
  assert.notEqual(textRules['banned-class']('hover:bg-black'), null);
  assert.equal(textRules['banned-class']('text-control'), null);
  assert.equal(textRules['banned-class']('text-xs-legacy'), null);
});

await test('a shadow outside the elevation scale fails', () => {
  assert.notEqual(textRules['raw-elevation']('flex shadow-sm'), null);
  assert.notEqual(textRules['raw-elevation']('hover:shadow-md'), null);
  assert.notEqual(textRules['raw-elevation']('rounded-xl shadow'), null);
  assert.notEqual(
    textRules['raw-elevation']('shadow-raised hover:shadow-xl'),
    null,
  );
  assert.equal(textRules['raw-elevation']('shadow-raised'), null);
  assert.equal(textRules['raw-elevation']('shadow-overlay rounded-xl'), null);
  assert.equal(textRules['raw-elevation']('shadow-modal'), null);
  // The property name of a transition is not a shadow utility.
  assert.equal(
    textRules['raw-elevation']('motion-safe:transition-shadow'),
    null,
  );
});

await test('motion outside the one motion module fails', () => {
  const screen = 'apps/web/src/screen.tsx';
  assert.notEqual(textRules['raw-motion']('transition-colors', screen), null);
  assert.notEqual(
    textRules['raw-motion']('motion-safe:transition', screen),
    null,
  );
  assert.notEqual(textRules['raw-motion']('duration-100', screen), null);
  assert.notEqual(textRules['raw-motion']('ease-quick', screen), null);
  // The one module that states the scale may name every part of it.
  assert.equal(
    textRules['raw-motion']('motion-safe:transition-colors', motionModule),
    null,
  );
  // A word that ends in the name of a utility is not that utility.
  assert.equal(textRules['raw-motion']('lease-held', screen), null);
  assert.equal(textRules['raw-motion']('flex items-center', screen), null);
});

await test('a path suffix or an identifier must not reach the person', () => {
  assert.notEqual(jsxTextRule('Open notes/today.md'), null);
  assert.notEqual(jsxTextRule('1f5c24b3-6995-41ec-98ac-7741aae373eb'), null);
  assert.equal(jsxTextRule('Open today'), null);
});

await test('the scan names every broken rule with its line', () => {
  const issues = scanSource(
    'apps/web/src/screen.tsx',
    [
      'export function Screen() {',
      '  return (',
      '    <p style={{ color: "red" }} className="text-xs w-[3rem]">',
      '      notes/today.md',
      '    </p>',
      '  );',
      '}',
      '',
    ].join('\n'),
  );
  const rules = issues.map((issue) => issue.rule).sort();
  assert.deepEqual(rules, [
    'arbitrary-value',
    'banned-class',
    'inline-style',
    'jsx-text',
  ]);
  assert.ok(issues.every((issue) => issue.line >= 3 && issue.line <= 4));
});

await test('an accepted file passes every rule', () => {
  assert.deepEqual(
    rulesOf(
      [
        'export function Screen() {',
        '  return <p className="text-control text-muted">Open today</p>;',
        '}',
        '',
      ].join('\n'),
    ),
    [],
  );
});

await test('unchecked markup fails in both forms', () => {
  assert.deepEqual(
    rulesOf(
      [
        'export function Screen(html: string) {',
        '  return <p dangerouslySetInnerHTML={{ __html: html }} />;',
        '}',
        '',
      ].join('\n'),
    ),
    ['inner-html'],
  );
  assert.deepEqual(
    scanSource(
      'apps/web/src/host.ts',
      'export function paint(host: Element, html: string) {\n  host.innerHTML = html;\n}\n',
    ).map((issue) => issue.rule),
    ['inner-html'],
  );
});

await test('a clean tree passes the command', () => {
  const result = check({
    'apps/web/src/screen.tsx':
      'export function Screen() {\n  return <p className="text-control">Open today</p>;\n}\n',
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /1 files checked/);
});

await test('a broken rule fails the command and names the file', () => {
  const result = check({
    'apps/web/src/screen.tsx':
      'export function Screen() {\n  return <p className="text-xs">Open today</p>;\n}\n',
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /apps\/web\/src\/screen\.tsx:2: banned-class/);
});

await test('an allowlist entry accepts one file and one rule only', () => {
  const source =
    'export function Screen() {\n  return <p className="text-xs">Open today</p>;\n}\n';
  const allow = JSON.stringify({
    allow: [
      {
        file: 'apps/web/src/screen.tsx',
        rule: 'banned-class',
        reason: 'A disposable fixture.',
      },
    ],
  });
  assert.equal(
    check({
      'apps/web/src/screen.tsx': source,
      'tools/design-rules-allow.json': allow,
    }).status,
    0,
  );
  assert.equal(
    check({
      'apps/web/src/other.tsx': source,
      'tools/design-rules-allow.json': allow,
    }).status,
    1,
  );
});

await test('a test file is not checked', () => {
  const result = check({
    'apps/web/src/screen.test.tsx': 'export const classes = "text-xs";\n',
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /0 files checked/);
});

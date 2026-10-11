import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { record, root } from './workspace.mjs';

await mkdir(join(root, '.tooling'), { recursive: true });

/** Check the exports before the test calls an installed dependency.
 * @param {unknown} value
 * @returns {value is {default: (source: string, options: {imports: Record<string, unknown>}) => (data: Record<string, unknown>) => string}} */
function templateModule(value) {
  return typeof record(value).default === 'function';
}

/** Check the parser before the test calls an installed dependency.
 * @param {unknown} value
 * @returns {value is {load: (source: string, options?: {maxTotalMergeKeys: number}) => unknown}} */
function yamlModule(value) {
  return typeof record(value).load === 'function';
}

await test('the diagram dependency refuses executable template import names', async () => {
  const web = createRequire(join(root, 'apps/web/package.json'));
  const mermaid = createRequire(web.resolve('mermaid'));
  const parser = createRequire(mermaid.resolve('chevrotain'));
  /** @type {unknown} */
  const lodash = parser('lodash-es/template.js');
  assert.ok(templateModule(lodash));
  const template = lodash.default;
  assert.equal(typeof template, 'function');
  assert.throws(
    () => template('', { imports: { 'untrusted = 1': undefined } }),
    /Invalid.*imports/,
  );
  assert.equal(
    template('<%= name %>', { imports: { name: 'Note' } })({}),
    'Note',
  );
});

/** @param {unknown} value
 * @returns {value is {renderToString: (source: string, options?: Record<string, unknown>) => string}} */
function mathModule(value) {
  return typeof record(value).renderToString === 'function';
}

/** @param {unknown} value
 * @returns {value is {context: (options: Record<string, unknown>) => Promise<{serve: (options: {host: string, port: number}) => Promise<{port: number}>, dispose: () => Promise<void>}>}} */
function buildModule(value) {
  return typeof record(value).context === 'function';
}

/** @param {unknown} value
 * @returns {value is {transformSync: (source: string, file: string) => {code: string, map: unknown}, transform: (source: string, file: string) => Promise<{code: string, map: unknown}>}} */
function transformModule(value) {
  return (
    typeof record(value).transformSync === 'function' &&
    typeof record(value).transform === 'function'
  );
}

const web = createRequire(join(root, 'apps/web/package.json'));
const markdown = createRequire(join(root, 'packages/markdown/package.json'));
const mermaid = createRequire(web.resolve('mermaid'));
const remark = createRequire(markdown.resolve('remark-math'));
const math = createRequire(remark.resolve('micromark-extension-math'));

/** @param {unknown} value
 * @returns {value is {math: () => unknown, mathHtml: (options?: Record<string, unknown>) => unknown}} */
function mathExtension(value) {
  return (
    typeof record(value).math === 'function' &&
    typeof record(value).mathHtml === 'function'
  );
}

/** @param {unknown} value
 * @returns {value is {micromark: (source: string, options: Record<string, unknown>) => string}} */
function markdownCompiler(value) {
  return typeof record(value).micromark === 'function';
}

await test('the micromark math path renders fractions and refuses inherited trust', () => {
  const parse = createRequire(markdown.resolve('remark-parse'));
  const from = createRequire(parse.resolve('mdast-util-from-markdown'));
  /** @type {unknown} */
  const compiler = from('micromark');
  /** @type {unknown} */
  const extension = remark('micromark-extension-math');
  assert.ok(markdownCompiler(compiler));
  assert.ok(mathExtension(extension));
  const options = {
    extensions: [extension.math()],
    htmlExtensions: [extension.mathHtml()],
  };
  assert.match(
    compiler.micromark(String.raw`$\frac{a}{b}$`, options),
    /<mfrac>/,
  );
  Object.defineProperty(Object.prototype, 'trust', {
    value: true,
    configurable: true,
    writable: true,
  });
  try {
    assert.doesNotMatch(
      compiler.micromark(String.raw`$\href{javascript:alert(1)}{x}$`, options),
      /<a href=/,
    );
  } finally {
    Reflect.deleteProperty(Object.prototype, 'trust');
  }
});

for (const { name, consumer } of [
  { name: 'diagram', consumer: mermaid },
  { name: 'Markdown', consumer: math },
]) {
  await test(`the ${name} math dependency ignores inherited trust`, () => {
    /** @type {unknown} */
    const katex = consumer('katex');
    assert.ok(mathModule(katex));
    const source = String.raw`\href{javascript:alert(1)}{x}`;
    assert.doesNotMatch(
      katex.renderToString(source, Object.create({ trust: true })),
      /<a href=/,
    );
    Object.defineProperty(Object.prototype, 'trust', {
      value: true,
      configurable: true,
      writable: true,
    });
    try {
      assert.doesNotMatch(katex.renderToString(source), /<a href=/);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'trust');
    }
    const normal = katex.renderToString(String.raw`\frac{a}{b}`, {
      throwOnError: true,
      displayMode: true,
      output: 'mathml',
    });
    assert.match(normal, /<mfrac>/);
    assert.match(normal, /<mi>a<\/mi>/);
    assert.match(normal, /<mi>b<\/mi>/);
  });
}

await test('the diagram math HTML uses the stylesheet selected by the web app', async () => {
  /** @type {unknown} */
  const katex = mermaid('katex');
  assert.ok(mathModule(katex));
  const html = katex.renderToString(String.raw`\frac{a}{b}`);
  const css = await readFile(web.resolve('katex/dist/katex.min.css'), 'utf8');
  const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap(
    (match) => match[1]?.split(' ') ?? [],
  );
  for (const name of ['katex-html', 'katex-base', 'katex-strut']) {
    assert.ok(classes.includes(name), `the output carries ${name}`);
    assert.ok(css.includes(`.${name}`), `the stylesheet reaches ${name}`);
  }
});

/** @param {NodeJS.Require} parent */
function legacyCompiler(parent) {
  const kit = createRequire(parent.resolve('drizzle-kit'));
  const loader = createRequire(kit.resolve('@esbuild-kit/esm-loader'));
  return {
    kit: join(dirname(kit.resolve('drizzle-kit')), 'bin.cjs'),
    loader: kit.resolve('@esbuild-kit/esm-loader'),
    utils: createRequire(loader.resolve('@esbuild-kit/core-utils')),
  };
}

const storage = createRequire(
  join(root, 'packages/storage-server/package.json'),
);
const server = createRequire(join(root, 'apps/server/package.json'));
const auth = createRequire(server.resolve('better-auth'));

for (const { name, parent } of [
  { name: 'migration tool', parent: storage },
  { name: 'auth dependency', parent: auth },
]) {
  const compiler = legacyCompiler(parent);
  await test(`the ${name} compiler refuses cross-origin source reads`, async () => {
    /** @type {unknown} */
    const esbuild = compiler.utils('esbuild');
    assert.ok(buildModule(esbuild));
    const context = await esbuild.context({
      stdin: {
        contents: 'export const note = "private source"',
        resolveDir: root,
      },
      write: false,
      outfile: join(root, '.tooling/cors-note.js'),
    });
    try {
      const { port } = await context.serve({ host: '127.0.0.1', port: 0 });
      const response = await fetch(`http://127.0.0.1:${port}/cors-note.js`, {
        headers: { Origin: 'https://untrusted.example' },
      });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /private source/);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    } finally {
      await context.dispose();
    }
  });

  await test(`the ${name} compiler keeps TypeScript transforms and imports`, async () => {
    /** @type {unknown} */
    const utils = compiler.utils('@esbuild-kit/core-utils');
    assert.ok(transformModule(utils));
    const source = 'export const note: string = "Note";';
    const cjs = utils.transformSync(source, join(root, '.tooling/note.cts'));
    const esm = await utils.transform(source, join(root, '.tooling/note.mts'));
    assert.match(cjs.code, /module\.exports/);
    assert.match(esm.code, /export/);
    assert.ok(cjs.map);
    assert.ok(esm.map);
    const fixture = await mkdtemp(join(root, '.tooling/compiler-'));
    try {
      await writeFile(join(fixture, 'note.ts'), source);
      await writeFile(
        join(fixture, 'read.mjs'),
        'import {note} from "./note.ts"; console.log(note);',
      );
      const output = execFileSync(
        process.execPath,
        [
          '--loader',
          pathToFileURL(compiler.loader).href,
          join(fixture, 'read.mjs'),
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      assert.equal(output.trim(), 'Note');
      const checked = execFileSync(process.execPath, [compiler.kit, 'check'], {
        cwd: join(root, 'packages/storage-server'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.match(checked, /Reading config file/);
      assert.match(checked, /Everything's fine/);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
}

await test('the contract parser counts empty sources toward the YAML merge budget', async () => {
  const generator = await realpath(
    join(
      root,
      'tools/sdk-codegen/node_modules/@hey-api/openapi-ts/package.json',
    ),
  );
  const parser = await realpath(
    join(dirname(generator), '../json-schema-ref-parser/package.json'),
  );
  /** @type {unknown} */
  const yaml = createRequire(parser)('js-yaml');
  assert.ok(yamlModule(yaml));
  const source =
    'base: &base {}\nmerged:\n  <<: [*base, *base, *base, *base]\n';
  assert.throws(() => yaml.load(source, { maxTotalMergeKeys: 1 }), /merge/i);
  assert.deepEqual(yaml.load('name: Note\n'), { name: 'Note' });
});

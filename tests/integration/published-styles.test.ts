/**
 * The published page reaches the one built application stylesheet.
 *
 * Plan 007 item 25 had two ways to give the page its presentation: read the
 * stylesheet link of the built shell document, or turn on a build manifest and
 * read that. The first won, because the server already reads that document to
 * hash the inline scripts of its content policy, and a manifest would have
 * been a second output of the build that describes the same fact. This file
 * holds both halves of that choice.
 *
 * The first half is the artefact: the built shell names exactly one stylesheet
 * and the resolver of the server finds it. The second half is the emission:
 * Tailwind writes a utility only when a source file uses it, and the class
 * names of the published document live in the server, so the stylesheet
 * registers that one file as a source. Compiling is deterministic and needs no
 * prior build; the artefact half needs the build that `pnpm test:integration`
 * already runs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  builtStylesheetHrefs,
  documentStylesheetHrefs,
  publishedDocumentClasses,
} from '@notesapp/server';
import { loadCompiler, webRequire } from './support/tailwind.ts';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const stylesheet = resolve(root, 'apps/web/src/tailwind.css');
const distribution = join(root, 'apps/web/dist/web');

/** Compiles the application stylesheet with the given candidates. */
async function buildCss(candidates: readonly string[]): Promise<string> {
  const compile = loadCompiler();
  const source = await readFile(stylesheet, 'utf8');
  const compiler = await compile(source, {
    base: dirname(stylesheet),
    loadStylesheet: async (
      id: string,
      base: string,
    ): Promise<{ path: string; base: string; content: string }> => {
      const path = id.startsWith('.')
        ? resolve(base, id)
        : webRequire.resolve(`${id}/index.css`);
      return {
        path,
        base: dirname(path),
        content: await readFile(path, 'utf8'),
      };
    },
  });
  return compiler.build([...candidates]);
}

await test('the built shell document names one stylesheet', async () => {
  const document = join(distribution, 'index.html');
  await stat(document).catch(() => {
    throw new Error(
      'The browser build is absent. Run pnpm build before this test.',
    );
  });
  const hrefs = documentStylesheetHrefs(document, statSync(document));
  assert.equal(hrefs.length, 1, 'the page loads one stylesheet and no second');
  const href = hrefs[0] ?? '';
  assert.ok(href.startsWith('/assets/'));
  assert.ok(href.endsWith('.css'));
  // The file is really there, so the page of a reader loads bytes and not a
  // not-found answer.
  await stat(join(distribution, href.slice(1)));
});

await test('the published page names the mathematics style as well', async () => {
  // The defect this covers: the application imports the mathematics style
  // with the module that renders a formula, so the build writes it as a file
  // of its own that the shell document does not name. The published page
  // holds no script, so it could not load it when it found that it needed it,
  // and mathematics on a published page had no style at all (record 0060).
  const assets = join(distribution, 'assets');
  await stat(assets).catch(() => {
    throw new Error(
      'The browser build is absent. Run pnpm build before this test.',
    );
  });
  const emitted = builtStylesheetHrefs(assets);
  assert.ok(
    emitted.length >= 2,
    'the build emits the theme and the mathematics style',
  );
  // Every one is really there, so the page of a reader loads bytes and not a
  // not-found answer.
  for (const href of emitted) await stat(join(distribution, href.slice(1)));

  // One of them is the mathematics style, which is what carries a formula.
  const contents = await Promise.all(
    emitted.map(async (href) =>
      readFile(join(distribution, href.slice(1)), 'utf8'),
    ),
  );
  assert.ok(
    contents.some((css) => css.includes('.katex')),
    'no emitted stylesheet carries the mathematics style',
  );

  // The shell stylesheet is among them, so the page keeps the theme.
  const document = join(distribution, 'index.html');
  const shell = documentStylesheetHrefs(document, statSync(document));
  for (const href of shell) assert.ok(emitted.includes(href), href);
});

await test('every class of the published document reaches the stylesheet', async () => {
  const css = await buildCss(publishedDocumentClasses);
  // The typography of the note body is the part that only this page uses, so
  // nothing else in the application would keep it alive. A descendant variant
  // is the utility that reaches generated markup, and it reads the named type
  // scale of the central theme.
  for (const rule of [
    'h1 {\n    font-size: var(--text-note-h1);',
    'code {\n    font-size: var(--text-note-mono);',
    'ul {\n    list-style-type: disc;',
    'table {\n    border-collapse: collapse;',
  ])
    assert.ok(css.includes(rule), rule);
  // The one column and the colours come from the same compilation, so the
  // page cannot drift from the theme.
  assert.ok(
    css.includes('.max-w-note {\n    max-width: var(--container-note);'),
  );
  assert.ok(css.includes('--notes-accent-text'));
});

await test('a class that no source names is not emitted', async () => {
  // The check above would pass on a stylesheet that emitted every utility, so
  // this case proves that the compilation is narrow.
  const css = await buildCss(['zz-not-a-utility']);
  assert.ok(!css.includes('zz-not-a-utility'));
});

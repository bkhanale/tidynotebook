import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { root } from './workspace.mjs';

/** Each CodeMirror package must have one identity for its plugins to work.
 * @param {string} lock */
function duplicateCodeMirrorPackages(lock) {
  const sections = lock.split('\npackages:\n').slice(1);
  assert.ok(sections.length > 0, 'The lockfile must have a packages section.');
  const packages = sections
    .map((section) => section.split('\nsnapshots:\n')[0])
    .join('\n');
  /** @type {Map<string, string[]>} */
  const versions = new Map();
  for (const match of packages.matchAll(
    /^ {2}['"]?(@codemirror\/[^@'":\s]+)@([^'":\s]+)['"]?:$/gm,
  )) {
    const name = match[1] ?? '';
    const version = match[2] ?? '';
    versions.set(name, [...(versions.get(name) ?? []), version]);
  }
  assert.ok(versions.size > 0, 'The lockfile must contain CodeMirror.');
  return [...versions].filter(([, found]) => found.length > 1);
}

await test('the lockfile has one copy of every CodeMirror package', async () => {
  const lock = await readFile(
    new URL('../pnpm-lock.yaml', import.meta.url),
    'utf8',
  );
  assert.deepEqual(duplicateCodeMirrorPackages(lock), []);
});

await test('the lock check detects different versions with each YAML key style', () => {
  for (const quote of ["'", '"', '']) {
    /** @param {string} version */
    const key = (version) => `  ${quote}@codemirror/view@${version}${quote}:`;
    const lock = `\npackages:\n${key('6.43.13')}\n${key('6.43.14')}\nsnapshots:\n`;
    assert.deepEqual(duplicateCodeMirrorPackages(lock), [
      ['@codemirror/view', ['6.43.13', '6.43.14']],
    ]);
  }
});

await test('a stream language displays its fold gutter and highlighted tokens', () => {
  // A separate process keeps browser globals out of the Node tool tests.
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    cwd: root,
    encoding: 'utf8',
    input: `
      import assert from 'node:assert/strict';
      import { Window } from 'happy-dom';
      import {
        defaultHighlightStyle, foldGutter, StreamLanguage, syntaxHighlighting,
      } from '@codemirror/language';
      import { EditorState } from '@codemirror/state';
      import { EditorView } from '@codemirror/view';

      const window = new Window();
      for (const [name, value] of Object.entries({
        window,
        document: window.document,
        MutationObserver: window.MutationObserver,
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
      })) Object.defineProperty(globalThis, name, { configurable: true, value });
      const language = StreamLanguage.define({
        token(stream) {
          stream.skipToEnd();
          return 'keyword';
        },
      });
      const view = new EditorView({
        parent: window.document.body,
        state: EditorState.create({
          doc: 'keyword',
          extensions: [language, syntaxHighlighting(defaultHighlightStyle), foldGutter()],
        }),
      });
      try {
        assert.equal(view.dom.querySelectorAll('.cm-foldGutter').length, 1);
        const token = view.dom.querySelector('.cm-line span[class]');
        assert.ok(token, 'The language must draw its highlighted token.');
        assert.equal(token.textContent, 'keyword');
      } finally {
        view.destroy();
        await window.happyDOM.close();
      }
    `,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

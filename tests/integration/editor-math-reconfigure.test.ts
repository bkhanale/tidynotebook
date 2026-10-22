import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { Window } from 'happy-dom';

await test('display math keeps its source range after viewport parsing and editor reconfiguration', async () => {
  // Install the DOM before loading CodeMirror, as in note-link-surfaces.
  const browser = new Window({ url: 'http://localhost/' });
  browser.document.write('<!doctype html><html><body></body></html>');
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = [
    'window',
    'document',
    'MutationObserver',
    'ResizeObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'getComputedStyle',
  ] as const;
  for (const name of globals) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value: unknown = browser[name];
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        typeof value === 'function' && /^[a-z]/.test(name)
          ? value.bind(browser)
          : value,
    });
  }
  try {
    const { createEditor, setEditorTheme, setEditorRich } =
      await import('../../packages/editor/dist/create-editor.js');
    const { findRichRegions } =
      await import('../../packages/editor/dist/widgets.js');
    const doc =
      '# Editor and math\n\n```javascript\nfunction greet(name) {\n  return `Hello, ${name}`;\n}\nconst count = 42;\n```\n\nInline math: $E = mc^2$.\n\n$$\n\\frac{a}{b} + \\sqrt{x^2 + y^2}\n$$\n\nEnd of smoke test.\n';
    const rich = { renderMath: () => '<span>Formula</span>' };
    const view = createEditor(document.body, doc, () => {}, {
      theme: 'light',
      rich,
    });
    try {
      const expected = findRichRegions(view.state);
      assert.deepEqual(
        expected.map(({ kind, from, to }) => ({ kind, from, to })),
        [
          { kind: 'math-inline', from: 121, to: 131 },
          { kind: 'math-display', from: 134, to: 170 },
        ],
      );
      // Let the lazy fence language and the viewport parse finish before
      // the theme transaction publishes the parser's cached work.
      await setTimeout(150);
      for (const theme of ['dark', 'light'] as const) {
        setEditorTheme(view, theme);
        setEditorRich(view, rich);
        assert.deepEqual(findRichRegions(view.state), expected);
        assert.equal(view.state.doc.toString(), doc);
        assert.ok(view.dom.textContent?.includes('End of smoke test.'));
      }
    } finally {
      view.destroy();
    }
  } finally {
    await browser.happyDOM.close();
    for (const [name, original] of originals) {
      if (original === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, original);
    }
  }
});

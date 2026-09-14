/**
 * The loading state reaches the built stylesheet.
 *
 * Tailwind emits a utility only when a source file uses it, so a class that
 * `packages/ui/src/loading.tsx` writes can exist in the component and be
 * missing from the page. The pulse and the screen reader text of the loading
 * state are exactly that kind of class: nothing else in the application uses
 * them, so nothing else would keep them alive.
 *
 * This test compiles the one application stylesheet with the Tailwind
 * compiler that the web build uses, with the class names of the loading
 * component as its candidates, and asserts that the rules come out.
 * Compiling is deterministic and needs no prior build.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const stylesheet = resolve(root, 'apps/web/src/tailwind.css');
const component = resolve(root, 'packages/ui/src/loading.tsx');

/** The Tailwind compiler that the web build uses. */
type Compile = (
  source: string,
  options: unknown,
) => Promise<{ build: (candidates: string[]) => string }>;

/** The module loader of the web application, so its toolchain is used. */
const load = createRequire(resolve(root, 'apps/web/package.json'));

/** Loads the Tailwind compiler through the web application resolver. */
function loadCompiler(): Compile {
  const loaded: unknown = load('tailwindcss');
  const module = loaded as {
    compile?: unknown;
    default?: { compile?: unknown };
  };
  const compile = module.compile ?? module.default?.compile;
  assert.equal(typeof compile, 'function');
  return compile as Compile;
}

/** Every class name token that the loading component can write. */
function candidatesOf(source: string): readonly string[] {
  const found = new Set<string>();
  const quoted = source.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
  for (const literal of quoted)
    for (const token of literal.slice(1, -1).split(/\s+/))
      if (token !== '' && /^[a-z][a-z0-9:/._-]*$/i.test(token))
        found.add(token);
  return [...found];
}

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
        : load.resolve(`${id}/index.css`);
      return {
        path,
        base: dirname(path),
        content: await readFile(path, 'utf8'),
      };
    },
  });
  return compiler.build([...candidates]);
}

const source = await readFile(component, 'utf8');
const css = await buildCss(candidatesOf(source));

await test('the loading state can pulse on a device that accepts motion', () => {
  assert.match(source, /motion-safe:animate-pulse/);
  assert.match(css, /animate-pulse/);
  assert.match(css, /@keyframes pulse/);
  assert.match(css, /prefers-reduced-motion/);
});

await test('the sentence of the loading state is there for a screen reader', () => {
  // The bars are decoration, so the sentence is the whole message. It must
  // stay in the accessibility tree and out of the picture.
  assert.match(source, /className="sr-only"/);
  assert.match(css, /\.sr-only\s*\{/);
});

await test('the placeholder bars take their fill from the theme', () => {
  // A placeholder never holds a colour of its own. It reads the quietest
  // tint of the active palette, exactly as every other surface does.
  assert.match(css, /\.bg-hover\s*\{/);
  assert.match(css, /--notes-surface-hover/);
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
});

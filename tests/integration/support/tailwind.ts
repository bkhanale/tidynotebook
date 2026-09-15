/**
 * The Tailwind compiler that the web build uses.
 *
 * Two tests compile the one application stylesheet: one proves that the
 * editor theme adapter reads declared variables, and one proves that the
 * loading screen writes emitted class names. Both need the same compiler,
 * loaded through the resolver of the web application so the toolchain is the
 * one the build runs.
 *
 * The module arrives as `unknown`, because Tailwind belongs to the web
 * application and not to this tree, so no declaration of it reaches here. A
 * run time check cannot prove the signature of a function, so the loader
 * below proves what it can: it finds a callable member, and it checks every
 * value that the call gives back. A missing member and an answer of the wrong
 * shape both fail the test with one sentence.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../../..');

/** What the two tests need from the compiler. */
export type Compile = (
  source: string,
  options: unknown,
) => Promise<{ build: (candidates: string[]) => string }>;

/** The module loader of the web application, so its toolchain is used. */
export const webRequire = createRequire(resolve(root, 'apps/web/package.json'));

/** A value that can be called, with every argument and answer unchecked. */
type Callable = (...args: readonly unknown[]) => unknown;

/** True when a value can be called. */
function isCallable(value: unknown): value is Callable {
  return typeof value === 'function';
}

/**
 * One member of a loaded module, or `undefined`.
 *
 * A module can arrive as an object or, when its entry point is one function
 * with members on it, as a function. Both hold members, so both are read.
 */
function memberOf(value: unknown, key: string): unknown {
  if (value === null) return undefined;
  if (typeof value !== 'object' && typeof value !== 'function')
    return undefined;
  if (!(key in value)) return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** One callable member of a loaded module, or `null`. */
function callableMember(value: unknown, key: string): Callable | null {
  const member = memberOf(value, key);
  return isCallable(member) ? member : null;
}

/** Wraps the loaded function so every answer it gives is checked. */
function checked(compile: Callable): Compile {
  return async (source, options) => {
    const compiler: unknown = await compile(source, options);
    const build = callableMember(compiler, 'build');
    if (build === null)
      throw new Error('The Tailwind compiler answered with no build step.');
    return {
      build: (candidates): string => {
        const css: unknown = build(candidates);
        if (typeof css !== 'string')
          throw new Error('The Tailwind build step answered with no CSS.');
        return css;
      },
    };
  };
}

/** The Tailwind compiler of the web application, or a loud refusal. */
export function loadCompiler(): Compile {
  const loaded: unknown = webRequire('tailwindcss');
  const compile =
    callableMember(loaded, 'compile') ??
    callableMember(memberOf(loaded, 'default'), 'compile');
  if (compile === null)
    throw new Error(
      'The Tailwind module of the web application exports no compile function.',
    );
  return checked(compile);
}

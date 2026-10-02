/**
 * The languages of a fenced code block (record 0159).
 *
 * This is the one list of the languages that a fence can name. The renderer
 * highlights a fence of a listed language with its parser, and the editor
 * builds its fence languages from the same entries, so a language added here
 * reaches the published page and the live preview at once.
 *
 * Each parser is a Lezer parser. It runs in the browser and in Node and
 * touches no document. It loads on first use, so a bundle that never meets a
 * fence of a language carries none of its parser, and a module here still
 * runs nothing when it loads.
 *
 * An unknown info string is not an error. The fence stays plain monospaced
 * text on both surfaces.
 */
import type { Parser } from '@lezer/common';

/** One language that a fence can name. */
export type CodeLanguage = {
  /** The name of the language, in lower case. */
  readonly name: string;
  /** Other info strings that name the language, in lower case. */
  readonly aliases: readonly string[];
  /** File extensions of the language, with no dot. */
  readonly extensions: readonly string[];
  /** Loads the parser of the language. */
  readonly parser: () => Promise<Parser>;
};

/** The JavaScript parser in one dialect. */
async function javascript(dialect: string): Promise<Parser> {
  const module = await import('@lezer/javascript');
  return module.parser.configure({ dialect });
}

/**
 * The CSS parser.
 *
 * The return type is the one of the package, which can still be configured,
 * because the HTML parser below parses a `style` attribute with it.
 */
async function css() {
  return (await import('@lezer/css')).parser;
}

/**
 * The HTML parser, with the script and the style of a page inside it.
 *
 * A `script` element holds JavaScript, and a `style` element and a `style`
 * attribute hold CSS, so each one is parsed in its own language, as the HTML
 * language of CodeMirror does.
 */
async function html(): Promise<Parser> {
  const [{ parser, configureNesting }, script, style] = await Promise.all([
    import('@lezer/html'),
    javascript('jsx'),
    css(),
  ]);
  return parser.configure({
    wrap: configureNesting(
      [
        { tag: 'script', parser: script },
        { tag: 'style', parser: style },
      ],
      [{ name: 'style', parser: style.configure({ top: 'Styles' }) }],
    ),
  });
}

/** Every language that a fence can name. */
export const codeLanguages: readonly CodeLanguage[] = [
  {
    name: 'javascript',
    aliases: ['js', 'jsx', 'node'],
    extensions: ['js', 'mjs', 'cjs', 'jsx'],
    parser: () => javascript('jsx'),
  },
  {
    name: 'typescript',
    aliases: ['ts', 'tsx'],
    extensions: ['ts', 'mts', 'cts', 'tsx'],
    parser: () => javascript('ts jsx'),
  },
  {
    name: 'json',
    aliases: [],
    extensions: ['json'],
    parser: async () => (await import('@lezer/json')).parser,
  },
  {
    name: 'css',
    aliases: [],
    extensions: ['css'],
    parser: css,
  },
  {
    name: 'html',
    aliases: ['htm', 'xhtml'],
    extensions: ['html', 'htm'],
    parser: html,
  },
];

/**
 * The language that one info string names, or `null`.
 *
 * The first word of the info string names the language, as CommonMark reads
 * it, and the match ignores case. The editor and the renderer both ask here,
 * so a fence names one language on both surfaces.
 */
export function codeLanguageOf(info: string): CodeLanguage | null {
  const word = (info.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (word === '') return null;
  return (
    codeLanguages.find(
      (language) => language.name === word || language.aliases.includes(word),
    ) ?? null
  );
}

/** The parsers that finished loading, by language name. */
const loaded = new Map<string, Parser>();

/** The loads that are under way, by language name. */
const loading = new Map<string, Promise<Parser>>();

/**
 * Loads the parser of one language once and keeps it.
 *
 * A second call answers the same parser, so a renderer that meets many fences
 * of one language loads its parser one time.
 */
export function loadCodeParser(language: CodeLanguage): Promise<Parser> {
  const done = loaded.get(language.name);
  if (done !== undefined) return Promise.resolve(done);
  const pending = loading.get(language.name);
  if (pending !== undefined) return pending;
  // A load that fails is not kept, so the next call tries again.
  const started = language.parser().then(
    (parser) => {
      loaded.set(language.name, parser);
      loading.delete(language.name);
      return parser;
    },
    (error: unknown) => {
      loading.delete(language.name);
      throw error;
    },
  );
  loading.set(language.name, started);
  return started;
}

/** The parser of one language if it already loaded, or `null`. */
export function loadedCodeParser(language: CodeLanguage): Parser | null {
  return loaded.get(language.name) ?? null;
}

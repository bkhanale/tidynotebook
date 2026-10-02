/**
 * The languages of a fenced code block (records 0159 and 0172).
 *
 * This is the one list of the languages that a fence can name. Each entry
 * loads a `Language` of `@codemirror/language`: the language of its
 * CodeMirror package, or `StreamLanguage` over a mode of
 * `@codemirror/legacy-modes` for a language that has no Lezer grammar. The
 * renderer highlights a fence with `language.parser`, and the editor mounts
 * the same language in the fence, so a token reads one colour on both
 * surfaces by construction and the editor keeps the indentation, the folding
 * data and the comment markers of the language.
 *
 * A language parses in Node and in the browser and touches no document until
 * a view mounts it. Each one loads on first use with a dynamic import, so a
 * bundle that never meets a fence of a language carries none of it, and a
 * module here still runs nothing when it loads. This is the one module of the
 * package that imports a CodeMirror package (record 0172).
 *
 * Markdown is not on the list: the token map of `./code-tokens.ts` gives a
 * Markdown construct no code colour (record 0159), so a Markdown fence reads
 * as plain text on both surfaces.
 *
 * An unknown info string is not an error. The fence stays plain monospaced
 * text on both surfaces, and `codeBlockLabel` still names it.
 */
import type { Language, StreamParser } from '@codemirror/language';
import type { Parser } from '@lezer/common';

/** One language that a fence can name. */
export type CodeLanguage = {
  /** The name of the language, in lower case. */
  readonly name: string;
  /** The name a person reads on the label of a code block. */
  readonly label: string;
  /** Other info strings that name the language, in lower case. */
  readonly aliases: readonly string[];
  /** File extensions of the language, with no dot. */
  readonly extensions: readonly string[];
  /** Loads the language. */
  readonly language: () => Promise<Language>;
};

/** A language over one stream mode of `@codemirror/legacy-modes`. */
async function stream(
  mode: Promise<StreamParser<unknown>>,
): Promise<Language> {
  const [{ StreamLanguage }, parser] = await Promise.all([
    import('@codemirror/language'),
    mode,
  ]);
  return StreamLanguage.define(parser);
}

/** One entry of the list. */
function entry(
  name: string,
  label: string,
  aliases: readonly string[],
  extensions: readonly string[],
  language: () => Promise<Language>,
): CodeLanguage {
  return { name, label, aliases, extensions, language };
}

/** Every language that a fence can name. */
export const codeLanguages: readonly CodeLanguage[] = [
  entry(
    'javascript',
    'JavaScript',
    ['js', 'jsx', 'node', 'mjs', 'cjs'],
    ['js', 'mjs', 'cjs', 'jsx'],
    async () => (await import('@codemirror/lang-javascript')).jsxLanguage,
  ),
  entry(
    'typescript',
    'TypeScript',
    ['ts', 'tsx', 'mts', 'cts'],
    ['ts', 'mts', 'cts', 'tsx'],
    async () => (await import('@codemirror/lang-javascript')).tsxLanguage,
  ),
  entry(
    'json',
    'JSON',
    [],
    ['json'],
    async () => (await import('@codemirror/lang-json')).jsonLanguage,
  ),
  entry(
    'css',
    'CSS',
    [],
    ['css'],
    async () => (await import('@codemirror/lang-css')).cssLanguage,
  ),
  // The script and the style of a page are JavaScript and CSS, which the
  // HTML language of CodeMirror parses in their own language.
  entry(
    'html',
    'HTML',
    ['htm', 'xhtml'],
    ['html', 'htm'],
    async () => (await import('@codemirror/lang-html')).htmlLanguage,
  ),
  entry(
    'python',
    'Python',
    ['py', 'python3', 'py3'],
    ['py'],
    async () => (await import('@codemirror/lang-python')).pythonLanguage,
  ),
  entry(
    'shell',
    'Shell',
    ['sh', 'bash', 'zsh', 'shellscript'],
    ['sh', 'bash', 'zsh'],
    () =>
      stream(
        import('@codemirror/legacy-modes/mode/shell').then(
          (mode) => mode.shell,
        ),
      ),
  ),
  entry(
    'sql',
    'SQL',
    [
      'postgresql',
      'postgres',
      'pgsql',
      'mysql',
      'mariadb',
      'sqlite',
      'plsql',
      'tsql',
    ],
    ['sql'],
    async () => (await import('@codemirror/lang-sql')).StandardSQL.language,
  ),
  entry(
    'go',
    'Go',
    ['golang'],
    ['go'],
    async () => (await import('@codemirror/lang-go')).goLanguage,
  ),
  entry(
    'rust',
    'Rust',
    ['rs'],
    ['rs'],
    async () => (await import('@codemirror/lang-rust')).rustLanguage,
  ),
  entry(
    'yaml',
    'YAML',
    ['yml'],
    ['yaml', 'yml'],
    async () => (await import('@codemirror/lang-yaml')).yamlLanguage,
  ),
  entry(
    'java',
    'Java',
    [],
    ['java'],
    async () => (await import('@codemirror/lang-java')).javaLanguage,
  ),
  entry(
    'c',
    'C',
    ['h'],
    ['c', 'h'],
    async () => (await import('@codemirror/lang-cpp')).cppLanguage,
  ),
  entry(
    'cpp',
    'C++',
    ['c++', 'cxx', 'cc', 'hpp', 'hxx', 'h++'],
    ['cpp', 'cxx', 'cc', 'hpp', 'hxx'],
    async () => (await import('@codemirror/lang-cpp')).cppLanguage,
  ),
  entry(
    'csharp',
    'C#',
    ['cs', 'c#'],
    ['cs'],
    () =>
      stream(
        import('@codemirror/legacy-modes/mode/clike').then(
          (mode) => mode.csharp,
        ),
      ),
  ),
  // A PHP file is a page with PHP inside it, so the language reads the page
  // as HTML around each `<?php` block, as the PHP language of CodeMirror does.
  entry(
    'php',
    'PHP',
    [],
    ['php'],
    async () => (await import('@codemirror/lang-php')).php().language,
  ),
  entry(
    'xml',
    'XML',
    ['svg', 'xsd', 'xsl', 'xslt', 'plist', 'rss', 'atom'],
    ['xml', 'svg', 'xsd', 'xsl'],
    async () => (await import('@codemirror/lang-xml')).xmlLanguage,
  ),
  entry(
    'dockerfile',
    'Dockerfile',
    ['docker', 'containerfile'],
    [],
    () =>
      stream(
        import('@codemirror/legacy-modes/mode/dockerfile').then(
          (mode) => mode.dockerFile,
        ),
      ),
  ),
  entry(
    'kotlin',
    'Kotlin',
    ['kt', 'kts'],
    ['kt', 'kts'],
    () =>
      stream(
        import('@codemirror/legacy-modes/mode/clike').then(
          (mode) => mode.kotlin,
        ),
      ),
  ),
  entry(
    'swift',
    'Swift',
    [],
    ['swift'],
    () =>
      stream(
        import('@codemirror/legacy-modes/mode/swift').then(
          (mode) => mode.swift,
        ),
      ),
  ),
  entry(
    'ruby',
    'Ruby',
    ['rb'],
    ['rb'],
    () =>
      stream(
        import('@codemirror/legacy-modes/mode/ruby').then((mode) => mode.ruby),
      ),
  ),
  entry(
    'toml',
    'TOML',
    [],
    ['toml'],
    () =>
      stream(
        import('@codemirror/legacy-modes/mode/toml').then((mode) => mode.toml),
      ),
  ),
  entry(
    'diff',
    'Diff',
    ['patch'],
    ['diff', 'patch'],
    () =>
      stream(
        import('@codemirror/legacy-modes/mode/diff').then((mode) => mode.diff),
      ),
  ),
];

/** The first word of an info string, as CommonMark reads it. */
function firstWord(info: string): string {
  return info.trim().split(/\s+/)[0] ?? '';
}

/**
 * The language that one info string names, or `null`.
 *
 * The first word of the info string names the language, as CommonMark reads
 * it, and the match ignores case. The editor and the renderer both ask here,
 * so a fence names one language on both surfaces.
 */
export function codeLanguageOf(info: string): CodeLanguage | null {
  const word = firstWord(info).toLowerCase();
  if (word === '') return null;
  return (
    codeLanguages.find(
      (language) => language.name === word || language.aliases.includes(word),
    ) ?? null
  );
}

/**
 * The label of a code block with one info string, or `null` (record 0173).
 *
 * A listed language reads its own name, any other info string reads its
 * first word as the author wrote it, and a block with no info string has no
 * label. The editor and the renderer both read it, so a block carries one
 * label on both surfaces.
 */
export function codeBlockLabel(info: string): string | null {
  const word = firstWord(info);
  if (word === '') return null;
  return codeLanguageOf(word)?.label ?? word;
}

/** The languages that finished loading, by language name. */
const loaded = new Map<string, Language>();

/** The loads that are under way, by language name. */
const loading = new Map<string, Promise<Language>>();

/**
 * Loads one language once and keeps it.
 *
 * A second call answers the same language, so a renderer that meets many
 * fences of one language loads it one time, and the editor and the renderer
 * of one page share it.
 */
export function loadCodeLanguage(language: CodeLanguage): Promise<Language> {
  const done = loaded.get(language.name);
  if (done !== undefined) return Promise.resolve(done);
  const pending = loading.get(language.name);
  if (pending !== undefined) return pending;
  // A load that fails is not kept, so the next call tries again.
  const started = language.language().then(
    (value) => {
      loaded.set(language.name, value);
      loading.delete(language.name);
      return value;
    },
    (error: unknown) => {
      loading.delete(language.name);
      throw error;
    },
  );
  loading.set(language.name, started);
  return started;
}

/** Loads the parser of one language, which the renderer highlights with. */
export async function loadCodeParser(language: CodeLanguage): Promise<Parser> {
  return (await loadCodeLanguage(language)).parser;
}

/** The parser of one language if it already loaded, or `null`. */
export function loadedCodeParser(language: CodeLanguage): Parser | null {
  return loaded.get(language.name)?.parser ?? null;
}

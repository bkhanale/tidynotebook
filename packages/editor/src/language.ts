/**
 * The one Markdown grammar of the editor.
 *
 * `@codemirror/lang-markdown` runs the Lezer Markdown parser. This module
 * configures it to the flavor that `@notesapp/markdown` defines: CommonMark,
 * the GFM bundle (tables, task items, strikethrough, autolinks), YAML front
 * matter, and the shared math delimiter rule. The maintained YAML front
 * matter wrapper gives the body to the Markdown parser and parses the leading
 * metadata as YAML. It does not evaluate or export a metadata value. Every
 * decoration, the outline, and every widget read `syntaxTree(state)` of the
 * language built here.
 *
 * Code inside a fence is parsed by a second language when one is known for
 * the info string. Those languages load on demand, so the initial bundle
 * carries none of them.
 */
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import {
  ensureSyntaxTree,
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { GFM } from '@lezer/markdown';
import { tags } from '@lezer/highlight';
import { mathMarkdownExtension } from './math-syntax.ts';

/**
 * The languages a fenced code block can be highlighted with.
 *
 * Each entry loads on first use. An unknown info string is not an error: the
 * fence body stays plain monospaced text with the language label visible.
 */
export const codeLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'node'],
    extensions: ['js', 'mjs', 'cjs', 'jsx'],
    load: () =>
      import('@codemirror/lang-javascript').then((module) =>
        module.javascript({ jsx: true }),
      ),
  }),
  LanguageDescription.of({
    name: 'typescript',
    alias: ['ts', 'tsx'],
    extensions: ['ts', 'mts', 'cts', 'tsx'],
    load: () =>
      import('@codemirror/lang-javascript').then((module) =>
        module.javascript({ jsx: true, typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: 'json',
    extensions: ['json'],
    load: () =>
      import('@codemirror/lang-javascript').then((module) =>
        module.javascript(),
      ),
  }),
  LanguageDescription.of({
    name: 'css',
    extensions: ['css'],
    load: () => import('@codemirror/lang-css').then((module) => module.css()),
  }),
  LanguageDescription.of({
    name: 'html',
    alias: ['htm', 'xhtml'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((module) => module.html()),
  }),
];

/**
 * The colours of code inside a fence.
 *
 * Only code tags appear here. Markdown's own tags (heading, emphasis, link)
 * are left out on purpose: the live preview decorations style those, and two
 * sources of truth for one appearance is what this rebuild removes.
 *
 * Every colour is one syntax variable of the active theme, which the theme
 * registry writes on the document element. A theme switch therefore repaints
 * the code of an open note without reconfiguring the editor.
 *
 * `syntaxTokenNames` is the shared contract of colour names between this
 * package and the `syntax` group of a theme in `@notesapp/ui`. A unit test
 * asserts the two lists agree, so the editor and the registry name the same
 * colours. `heading` and `link` stay in the contract because every theme still
 * declares them, but the code style below no longer reads them: a Markdown
 * heading and a Markdown link take their colour from the note typography in
 * the live preview, not from the code palette.
 */
export const syntaxTokenNames = [
  'keyword',
  'string',
  'comment',
  'number',
  'tag',
  'attribute',
  'heading',
  'link',
  'punctuation',
] as const;

function syntaxColour(name: (typeof syntaxTokenNames)[number]): string {
  return `var(--notes-syntax-${name})`;
}

/**
 * The highlight specs for code inside a fence.
 *
 * A Markdown tag never appears here. A heading, strong text, emphasis, and a
 * link are Markdown constructs, and the live preview decorations in
 * `./live-preview.ts` style those from the note typography (`--notes-text-*`
 * and `--notes-accent-*`). If this style also carried `tags.heading`,
 * `tags.strong`, or `tags.link`, it would repaint the Markdown heading, the
 * bold run, and the link with the code palette, so the note text would take a
 * code colour. Exported so a unit test can hold that rule.
 */
export const codeHighlightSpecs = [
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.definitionKeyword,
      tags.operatorKeyword,
    ],
    color: syntaxColour('keyword'),
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: syntaxColour('string'),
  },
  {
    // `tags.meta` is not here, and it cannot be. The Markdown grammar marks
    // every marker of a note, the list mark, the quote mark, the emphasis
    // mark and the table separator, with `tags.processingInstruction`, which
    // `@lezer/highlight` defines as a child of `tags.meta`, and a highlight
    // style paints a child through its parent. One entry for the meta token
    // of a language therefore painted every marker of every note in the
    // comment colour and leaned it, in a span inside the decoration, where no
    // rule of the adapter could reach it.
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: syntaxColour('comment'),
    fontStyle: 'italic',
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: syntaxColour('number'),
  },
  {
    tag: [tags.tagName, tags.typeName, tags.className, tags.namespace],
    color: syntaxColour('tag'),
  },
  {
    tag: [
      tags.attributeName,
      tags.propertyName,
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
    ],
    color: syntaxColour('attribute'),
  },
  {
    tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket],
    color: syntaxColour('punctuation'),
  },
  { tag: tags.invalid, color: 'var(--notes-danger-text)' },
] as const;

const codeHighlightStyle = HighlightStyle.define([...codeHighlightSpecs]);

/**
 * The Markdown language support of the note editor.
 *
 * `addKeymap` stays on, so Enter continues a list and a quote the way the
 * upstream Markdown package defines it. Formatting shortcuts are added
 * separately by the keymap module.
 */
export function noteMarkdown(): LanguageSupport {
  return yamlFrontmatter({
    content: markdown({
      extensions: [GFM, mathMarkdownExtension],
      codeLanguages: [...codeLanguages],
    }),
  });
}

/** The language plus the colors its fenced code needs. */
export function noteMarkdownExtensions(): Extension {
  return [noteMarkdown(), syntaxHighlighting(codeHighlightStyle)];
}

/** How many pumps of the parser {@link parsedWhole} allows before it refuses. */
const wholeDocumentAttemptBound = 500;

/** How much parsing work one pump of {@link parsedWhole} buys, in milliseconds. */
const wholeDocumentSliceBudget = 5000;

/** Tuning knobs of {@link parsedWhole}, for a test that proves its refusal. */
export type ParsedWholeOptions = {
  /**
   * Overrides the attempt bound.
   *
   * A test sets this to 0 to force the refusal without waiting on a slow
   * machine: a fresh state only ever parses its initial viewport of about
   * 3000 characters, so a document past that length is provably partial
   * before the first pump.
   */
  readonly attempts?: number;
};

/**
 * Pumps the parser of a state until its tree covers the whole document.
 *
 * A view parses at least its viewport before it renders, so the live
 * preview always reads a tree that is ready for what is on screen. A
 * headless state, the kind a test or an offline reader builds, parses in
 * slices instead and keeps the unfinished work in its parse context. This
 * helper drives that background work into the state field one slice at a
 * time, the same way `@codemirror/language` drives it during idle time in a
 * real view.
 *
 * The bound exists so a stuck parse fails loudly instead of spinning
 * forever. When the tree still does not cover the document after the bound
 * is spent, this throws instead of handing back a state whose tree is
 * partial: a caller that compares a partial tree against the whole document
 * would read the gap as a Markdown defect instead of a parser refusal.
 */
export function parsedWhole(
  state: EditorState,
  options: ParsedWholeOptions = {},
): EditorState {
  const attemptBound = options.attempts ?? wholeDocumentAttemptBound;
  let current = state;
  for (
    let attempt = 0;
    attempt < attemptBound && syntaxTree(current).length < current.doc.length;
    attempt += 1
  ) {
    ensureSyntaxTree(current, current.doc.length, wholeDocumentSliceBudget);
    current = current.update({}).state;
  }
  const reached = syntaxTree(current).length;
  if (reached < current.doc.length)
    throw new Error(
      `the parser stopped at ${String(reached)} of ${String(current.doc.length)} characters`,
    );
  return current;
}

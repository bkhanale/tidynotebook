/**
 * The one Markdown grammar of the editor.
 *
 * `@codemirror/lang-markdown` runs the Lezer Markdown parser. This module
 * configures it to the flavor that `@notesapp/markdown` defines: CommonMark,
 * the GFM bundle (tables, task items, strikethrough, autolinks), and the
 * shared math delimiter rule. Nothing else scans Markdown in this package.
 * Every decoration, the outline, and every widget read `syntaxTree(state)`
 * of the language built here.
 *
 * Code inside a fence is parsed by a second language when one is known for
 * the info string. Those languages load on demand, so the initial bundle
 * carries none of them.
 */
import { markdown } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  syntaxHighlighting,
} from '@codemirror/language';
import type { Extension } from '@codemirror/state';
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
 * `syntaxTokenNames` is the same list of names that the `syntax` group of a
 * theme declares in `@notesapp/ui`. A unit test of this package asserts the
 * two lists agree, so a theme cannot publish a colour the editor never reads.
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

const codeHighlightStyle = HighlightStyle.define([
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
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.meta],
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
    tag: [tags.heading, tags.strong],
    color: syntaxColour('heading'),
  },
  { tag: [tags.link, tags.url], color: syntaxColour('link') },
  {
    tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket],
    color: syntaxColour('punctuation'),
  },
  { tag: tags.invalid, color: 'var(--notes-danger-text)' },
]);

/**
 * The Markdown language support of the note editor.
 *
 * `addKeymap` stays on, so Enter continues a list and a quote the way the
 * upstream Markdown package defines it. Formatting shortcuts are added
 * separately by the keymap module.
 */
export function noteMarkdown(): LanguageSupport {
  return markdown({
    extensions: [GFM, mathMarkdownExtension],
    codeLanguages: [...codeLanguages],
  });
}

/** The language plus the colors its fenced code needs. */
export function noteMarkdownExtensions(): Extension {
  return [noteMarkdown(), syntaxHighlighting(codeHighlightStyle)];
}

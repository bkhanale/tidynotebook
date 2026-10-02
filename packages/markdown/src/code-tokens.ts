/**
 * The tokens of code inside a fence (record 0159).
 *
 * The parsers of `./code-languages.ts` mark each piece of code with Lezer
 * highlight tags. This module is the one map from those tags to the names of
 * the code colours of the theme registry, so the editor and the published
 * page give one token one colour.
 *
 * The editor builds its highlight style from `codeTokenTags`, and the
 * renderer writes one class from `codeTokenClass` for each token through
 * `codeHighlighter`. A tag that is not in the map is plain text on both
 * surfaces.
 *
 * A Markdown tag never appears here. A heading, strong text, emphasis and a
 * link are Markdown constructs that the note typography styles. `tags.meta`
 * cannot appear either: the Markdown grammar marks every marker of a note with
 * `tags.processingInstruction`, which `@lezer/highlight` defines as a child of
 * `tags.meta`, and a highlighter paints a child through its parent, so one
 * entry for the meta token painted every list mark of every note.
 */
import { tagHighlighter, tags, type Tag } from '@lezer/highlight';

/**
 * The code tokens, in a fixed order.
 *
 * Every name but `invalid` is a name of the syntax group of a theme in
 * `@notesapp/ui`. `invalid` takes the danger text colour of the palette.
 */
export const codeTokenNames = [
  'keyword',
  'string',
  'comment',
  'number',
  'tag',
  'attribute',
  'punctuation',
  'invalid',
] as const;

/** One code token. */
export type CodeToken = (typeof codeTokenNames)[number];

/** One code token and the Lezer tags that it colours. */
export type CodeTokenTags = {
  readonly token: CodeToken;
  readonly tags: readonly Tag[];
};

/** The one map from a Lezer tag to a code token. */
export const codeTokenTags: readonly CodeTokenTags[] = [
  {
    token: 'keyword',
    tags: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.definitionKeyword,
      tags.operatorKeyword,
    ],
  },
  {
    token: 'string',
    tags: [tags.string, tags.special(tags.string), tags.regexp],
  },
  {
    token: 'comment',
    tags: [tags.comment, tags.lineComment, tags.blockComment],
  },
  { token: 'number', tags: [tags.number, tags.bool, tags.null, tags.atom] },
  {
    token: 'tag',
    tags: [tags.tagName, tags.typeName, tags.className, tags.namespace],
  },
  {
    token: 'attribute',
    tags: [
      tags.attributeName,
      tags.propertyName,
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
    ],
  },
  {
    token: 'punctuation',
    tags: [tags.operator, tags.punctuation, tags.separator, tags.bracket],
  },
  { token: 'invalid', tags: [tags.invalid] },
];

/** The class of one code token in rendered HTML. */
export function codeTokenClass(token: CodeToken): string {
  return `notes-code-${token}`;
}

/** Every class that the renderer writes on a code token. */
export const codeTokenClasses: readonly string[] =
  codeTokenNames.map(codeTokenClass);

/** The highlighter of the renderer: one class for each code token. */
export const codeHighlighter = tagHighlighter(
  codeTokenTags.map((entry) => ({
    tag: entry.tags,
    class: codeTokenClass(entry.token),
  })),
);

# 0159. One highlighter colours code on both surfaces

- Status: Accepted
- Date: 2026-10-02

## Context

The editor highlights a fence with the Lezer parsers of the CodeMirror
language packages, listed in `codeLanguages` of
`packages/editor/src/language.ts`, and colours each token from the syntax
group of the theme. `renderMarkdown` writes the code as plain text, so the
published page shows no colour. A second highlighter on the server would
bring other grammars and other token names. Audit of 2026-10-02, finding 4,
and [issue 237](https://github.com/bkhanale/notesapp/issues/237). See
[design 021](../design/021-the-published-page-draws-what-the-editor-draws.md).

## Decision

- `packages/markdown/src/code-languages.ts` is the one list of the languages
  of a fence: the name, the aliases, the file extensions, and the Lezer
  parser, which loads on first use.
- `packages/markdown/src/code-tokens.ts` is the one map from a Lezer tag to a
  code token, and the token names are the code names of the syntax group of
  the theme registry.
- `renderMarkdown` highlights a fence of a listed language with
  `highlightCode` of `@lezer/highlight`, and writes one `span` with the class
  `notes-code-<token>` for each token. The sanitizer keeps those class names
  and no other one.
- The editor builds its fence languages and its highlight style from the same
  list and the same map. A new language is one entry of the list, and both
  surfaces get it.
- The page colours a token through a `--color-syntax-<token>` theme variable
  of `apps/web/src/tailwind.css`, which reads the `--notes-syntax-*` value of
  the registry.
- `packages/markdown` may import `@lezer/common`, `@lezer/highlight` and the
  Lezer language packages. It imports no CodeMirror package.

This excludes a second highlighter, such as Prism, highlight.js or Shiki.

## Consequences

- A fence has the same tokens and the same colours on both surfaces.
- The editor builds a fence language from a bare parser, so a fence keeps the
  indentation of the line above and has no completion and no folding of its
  own language.
- `code-languages.test.ts` and `render.test.ts` prove the tokens and the
  sanitized output, `language.test.ts` that the editor reads the one list,
  and `tests/integration/published-page.test.ts` and
  `theme-variables.test.ts` the served page and the colours.

# 0172. A fence language is a CodeMirror language of the one list

- Status: Accepted
- Date: 2026-10-02

## Context

Record 0159 made `packages/markdown/src/code-languages.ts` the one list of
fence languages, with a bare Lezer parser for each, and kept every CodeMirror
package out of `packages/markdown`. Five languages are on it (issue 242, audit
finding 5). Shell, SQL and a Dockerfile have no Lezer package, and a fence of
the editor lost the indentation and the comment markers of its language. See
[design 022](../design/022-markdown-of-other-tools.md).

## Decision

- Each entry of the one list loads a `Language` of `@codemirror/language`: the
  language of its CodeMirror package, or `StreamLanguage` over a mode of
  `@codemirror/legacy-modes`. It states its name, its label, its aliases and
  its file extensions.
- The renderer highlights with `language.parser`. The editor mounts the same
  language in a fence, so a token reads one colour by construction, and the
  indentation, the folding data and the comment markers of the language work
  inside it.
- The list holds JavaScript, TypeScript, JSON, CSS, HTML, Python, shell, SQL,
  Go, Rust, YAML, Java, C, C++, C#, PHP, XML, Dockerfile, Kotlin, Swift,
  Ruby, TOML and diff. Markdown is not on it: the token map gives a Markdown
  construct no code colour (record 0159).
- `packages/markdown` may import `@codemirror/language`, the language
  packages and the legacy modes, from `code-languages.ts` alone, each with a
  dynamic import. It imports no other CodeMirror package.
- `code-tokens.ts` maps the inserted and the deleted line of a diff to the
  string and the invalid token.

This refines record 0159.

## Consequences

- A Node process loads `@codemirror/state` and `@codemirror/view` with the
  first fence of a language. No module of the list runs when it loads, so the
  first route of the web application carries no language (record 0136).
- `code-languages.test.ts` holds the tokens of each language,
  `language.test.ts` that the editor reads the one list and indents a fence,
  and `language-resume.test.ts` a fence of each new kind of parser.

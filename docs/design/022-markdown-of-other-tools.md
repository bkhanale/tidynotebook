# Markdown of other tools

Status: active

## The problem

A note often starts its life in another tool. A person copies a page of
GitHub, imports an Obsidian vault, or pastes a README with a formula and a
block of shell. The audit of 2026-10-02 compared the product with Obsidian,
Typora, Bear and the GitHub renderer, and its finding 5 lists three places
where that Markdown does not survive the trip. Three issues hold them: 240,
241 and 242.

1. Inline math needs `$$x$$` or `\(x\)`. The form `$x$` of GitHub, Obsidian,
   Typora and Pandoc stays text in the editor and on the published page, so a
   formula of an imported note reads as dollars and letters.
2. Typing `[[` opens a list of notes and inserts a standard link, which
   record 0004 chose. A `[[Note]]` that a person types to its end, pastes, or
   brings in with a vault stays plain text, so the list promises a form that
   the product does not keep.
3. A fence is highlighted in five languages. Python, shell, SQL, Go, Rust and
   YAML read as plain text, and a code block has no language label and no copy
   action. Since design 021, the editor builds a fence language from a bare
   Lezer parser, so a fence also lost the indentation and the comment key of
   its language.

This design states the options for each, with the cost of each one.

## Inline math with one dollar

**Keep two dollars.** It costs nothing and keeps every price safe. It also
keeps every formula of GitHub and Obsidian as text, which is the defect.

**Take the single dollar rule of remark-math.** remark-math has an option for
it. The rule is the rule of a code span: a run of one dollar opens, and the
next run of one dollar closes, whatever stands around it. `It costs $5 and $10
today` then holds the formula `5 and `. A note of prices breaks on the day the
option turns on.

**Take the rule of Pandoc.** One dollar opens math when the next character is
not a space. It closes on a dollar whose previous character is not a space and
whose next character is not a digit. `$5 and $10` stays text, because the
second dollar has a space before it and a digit after it, and `$x^2$` is math.
An escaped `\$` is a dollar. GitHub, Obsidian and Typora follow the same idea,
so a note from any of them reads the same here. The cost is a construct of our
own in each grammar: a micromark construct for remark, as the parenthesis pair
of `math-parens.ts` is, and one more inline parser in the Lezer grammar. Both
read one rule of `packages/markdown/src/math-syntax.ts`, and the equivalence
corpus and the parse in slices hold them together. A prose note that writes
`$HOME/$USER` holds math after the change, which is what Pandoc reads too; a
code span keeps such text literal.

The text of a note does not change. An export writes the dollars as the
person wrote them, because every one of these tools reads them.

## Links of a wiki

Record 0004 keeps standard links at rest, so every exported note opens in any
CommonMark reader. Three options meet that record.

**Read the wiki form as a link.** The renderer, the index of links and the
editor would each learn `[[Note]]`. That is the second link syntax that record
0004 removed, and an export would hold links that other readers show as text.

**Insert a standard link from the list and nothing else.** That is the
product today. The list after `[[` writes `[Note](Note.md)`. Everything else
stays text, so a vault comes in with dead links and a pasted page with
brackets.

**Convert at the border.** A wiki link becomes a standard link at the moment
it enters a note, and only when its target is a note or an image of the
workspace: when the list inserts it, when the person types its closing
brackets, when a paste holds it, and when an import holds it. A target that
does not resolve keeps its text, so nothing becomes a link to a note that is
not there and no text is lost. The stored note holds standard links alone, so
record 0004 stands.

The last option is the one that keeps one link syntax and still lets a vault
work. Its parts:

- The converter lives in `packages/markdown`, beside the parser, and it reads
  the parse tree, so a `[[` inside code, inside math or behind a backslash is
  never converted. The import, the paste and the editor call the one
  function.
- A target resolves the way Obsidian resolves it. A path with a folder names
  that path, from the folder of the note first and then from the root. A bare
  name matches every note of that name, case aside. One match is the target.
  Several prefer the one in the folder of the note, then the one of the
  fewest folders, and a tie stays unresolved, because a guess would link the
  wrong note.
- `[[Note|label]]` takes the label, `[[Note#Heading]]` the fragment of the
  heading, and `![[image.png]]` becomes a picture. An embed of a note becomes
  a link, because no surface draws one note inside another.
- The destination is the portable relative path that a link between notes
  holds today, with the one `.md` suffix, and its label is escaped, so a note
  named `C# [draft]` still gives one link. The encoding of that path takes
  `#` and `?` as well as a space, because both end a path.
- An Obsidian vault keeps its pictures beside its notes, and an import of this
  product keeps them in `attachments/`. The import moves such a picture into
  `attachments/` under its own path, and rewrites the standard links to it.
  The folder of the settings of Obsidian and the other hidden entries of a
  vault are not notes, so the import leaves them out.

A paste converts as well, with the notes that the device knows. A person who
pastes a page of a vault into a note reads links, and a person who pastes a
`[[` that names no note reads the text they copied.

## Code

### More languages

**More Lezer packages.** Python, Go, Rust, YAML, Java, C, C++, PHP and XML
each have one, and the list of record 0159 takes them as they are. Shell, SQL
and a Dockerfile have none. SQL lives in `@codemirror/lang-sql`, and shell and
Dockerfile in the stream modes of `@codemirror/legacy-modes`, which run through
`StreamLanguage` of `@codemirror/language`.

**A second highlighter for the rest.** highlight.js or Shiki knows every
language, with other grammars and other token names, so a fence would read one
way in the editor and another way on the page. Design 021 refused this.

**The CodeMirror language packages in the one list.** Each package holds the
Lezer parser and, beside it, the indentation, the folding and the comment
markers of its language. A `Language` of CodeMirror parses in Node and in the
browser and touches no document until a view mounts it, so the renderer can
take `language.parser` and the editor can take the language whole. One entry
of the list then gives both surfaces the same parser object, so a token reads
one colour by construction, and the editor gets the editing of the language
back. The cost is that `packages/markdown` imports `@codemirror/language` and
the language packages, which bring `@codemirror/state` and `@codemirror/view`
into a Node process the first time it renders such a fence. Each one loads on
first use, so no bundle and no server start carries a language that no note
names.

The last option keeps one list and one parser for each language, and it is
the only one that gives the editor its editing back without a second list.
Markdown itself stays out of the list: the map of code tokens gives a Markdown
construct no code colour on purpose (record 0159), so a Markdown fence reads
as plain text on both surfaces with or without a parser.

### A label and a copy action

A fence of the editor hides its fence lines while the caret is away, so its
language is not on the screen. A label and a copy button need a place.

**A widget in the text.** Record 0002 keeps the set of widgets closed, and a
widget in the first line of the code moves the caret around it.

**A layer of controls over the text.** The handles of a table (record 0147)
and the grip of a list item (record 0106) stand in one layer over the text,
replace no text and hold no caret. The code block takes a bar at the top of
its card in the same way: the language on the left, a copy button on the
right, from the recipes of `packages/ui`. The first line of the card keeps the
room for the bar.

The published page has no script of its own, and a copy needs the clipboard.

**No copy on the page.** A reader selects the text. The page keeps the policy
that refuses every script for a note with no diagram.

**One script of the published page.** Record 0158 gave a page with a diagram
one file of the build, named by its exact address. The same file can put a
copy button on each code block. A page that holds code then names that file
too, with no frame. A reader with no script reads the label and the code, and
the file is still the one script that the policy names.

The second option gives a reader the action that GitHub and every
documentation site give, and the policy still permits no inline script, no
other file and no third party. The label is part of the HTML of the renderer,
so it needs no script at all.

## Decisions

- [0170](../decisions/0170-one-dollar-opens-math-by-the-rule-of-pandoc.md):
  one dollar opens math by the rule of Pandoc.
- [0171](../decisions/0171-a-wiki-link-becomes-a-standard-link-at-the-border.md):
  a wiki link becomes a standard link at the border.
- [0172](../decisions/0172-a-fence-language-is-a-codemirror-language-of-the-one-list.md):
  a fence language is a CodeMirror language of the one list.
- [0173](../decisions/0173-a-code-block-carries-its-language-and-a-copy-action.md):
  a code block carries its language and a copy action.

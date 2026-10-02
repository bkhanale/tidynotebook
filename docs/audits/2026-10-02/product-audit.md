# Audit of the Markdown core, robustness and interface

- Date: 2026-10-02
- Commit read: 2ed7c55

This audit reads the product as a person uses it and compares it with the
best Markdown editors: Obsidian, Typora, Bear and the GitHub renderer. A
finding names the code by path. The numbers of the performance run are in
[performance.md](performance.md).

## How the audit ran

The application of one worktree ran through the `testing-changes-end-to-end`
skill. Drive scripts in Playwright made notes by typing, by a paste of
Markdown and by a paste of HTML. They opened every route in light and in
dark, on a laptop screen and on a 390 px phone screen. One sample note held
every construct of the corpus and was published, so the editor and the
published page could be compared side by side.

Two checks ran outside the browser:

- The editor grammar of `packages/editor/src/language.ts` parsed one note,
  stopped at every third offset, continued, and was compared with a parse of
  the whole text in one pass.
- A set of edge cases went through the editor grammar and through
  `parseMarkdown` and `renderMarkdown` of `packages/markdown`, and the block
  trees and the HTML were compared.

## Finding 1: a display math block breaks the live preview

A note that holds a `$$` block and a later fence showed correctly after a
paste. After the note opened again, the `$$` lines showed as plain text. The
fence after them showed its opening line as text, and its closing fence
started a code block that covered every line to the end of the note.

The stop and continue check reproduces it without a browser. A parse that
stops inside the math block, or inside the fence after it, and then
continues gives a different tree from a parse in one pass. The math block
becomes two paragraphs. A parse that stops inside a built-in fence never
differs. A view always parses in slices, so a person meets this on a long
note.

- The block parser is `parseMathBlock` in
  `packages/editor/src/math-syntax.ts`.
- No test stops a parse inside a math block and continues it.

## Finding 2: leaving a list with Enter changes the document

Enter on an empty list item ends the list but writes no blank line. The next
line is joined to the last item: the text is `- two` and then `After list`
on the next line. CommonMark reads that line as a lazy continuation of the
item. The editor shows it as a new paragraph at the left edge. The published
page shows it inside the item, after a line break. What a person sees is not
what they publish or export. Obsidian and Typora write a blank line here.

## Finding 3: HTML in a note is lost on the published page

`renderMarkdown` in `packages/markdown/src/render.ts` drops every HTML node
with its tags.

- Inline `<kbd>`, `<sub>`, `<sup>`, `<mark>` and `<br>` lose their meaning.
  `hi<br>next` becomes one word, and `H<sub>2</sub>O` loses the subscript.
- In a `<details>` block, the text of `<summary>` is removed.
- The editor shows the same tags as raw source in the code colour.

The GitHub renderer keeps a safe subset of these elements through its
sanitizer. The schema is in `packages/markdown/src/policy.ts`.

## Finding 4: the editor and the published page differ

The sample note looked different on the two surfaces:

- A Mermaid fence draws a diagram in the editor and shows its source on the
  published page.
- Code on the published page has no highlighting. In light, a code block has
  no fill, so it reads as indented text.
- A task item on the published page shows a bullet and a faint native
  checkbox. The editor shows a task box and no bullet.
- The header row of a published table ignores the column alignment that its
  cells follow. The table fills the column, while the editor sizes it to its
  text.
- The published H1 is close to the size of H2.
- The editor grammar has no footnote. A footnote shows as raw `[^n]` text in
  the editor and as a real footnote on the published page.

## Finding 5: compatibility with other Markdown tools

- Inline math needs `$$x$$` or `\(x\)`. The form `$x$` of GitHub, Obsidian
  and Typora stays text, so a formula in an imported note does not render.
  The rule is in `packages/markdown/src/math-syntax.ts`.
- `[[` opens a completion of note names, but a `[[Note]]` link stays plain
  text. Record 0004 chose standard links, so the completion sends a mixed
  signal, and the links of an imported vault do not work.
- Highlighting covers JavaScript, TypeScript, JSON, CSS and HTML only
  (`codeLanguages` in `packages/editor/src/language.ts`). Python, shell, SQL,
  Go, Rust and YAML are not highlighted. A code block has no language label
  and no copy action.

## Finding 6: import accepts less than export writes

`apps/server/src/routes/unzip.ts` refuses an archive of more than 1000
entries. `apps/server/src/routes/zip.ts` writes up to 65535. A workspace of
more than 1000 notes cannot come back through its own export, and an
Obsidian vault of that size cannot come in. The refusal title says that the
submitted content does not match its digest, which names a different
failure.

## Finding 7: the web application has no error boundary

No route of `apps/web/src/router.tsx` has an `errorElement`, and no module of
`apps/web/src` or `packages/ui/src` defines an error boundary. An exception
during a render shows the default page of React Router.

## Finding 8: one word for two actions

The menu of a note row in the tree says Delete
(`apps/web/src/shell/shell.tsx`, `NoteRow`) and moves the note to Trash. The
note menu calls the same action Move to Trash. In Trash, Delete removes a
note for good. The rule of one term for one thing in `AGENTS.md` is broken.

## Finding 9: search configuration differs from the contract

The contract of `searchFiles` in
`packages/api-contract/paths/api_workspaces_workspaceId_search.yaml` states
the simple text configuration. The search document in
`packages/storage-server/src/schema.ts` uses the English configuration, so a
note in another language is stemmed by English rules.

## Finding 10: surfaces outside the design system

- Find and replace (Ctrl + F) is the stock CodeMirror panel: lowercase
  labels such as next, regexp and by word, grey native buttons and a raw
  close mark.
- The completion list of `[[` is the stock CodeMirror list, with square
  corners and a black selected row.

## Finding 11: notices that alarm or that are cut

- The notice of `persistenceDenialMessage` in `apps/web/src/pwa/lifecycle.ts`
  is a large red block on every note. Chrome refuses persistent storage to a
  site with little use, so a real person sees it too, not only a headless
  browser.
- The status line of the sidebar footer is cut at its end, for example "No
  connection. Your notes stay on…". The text is in
  `apps/web/src/lib/sync-state.ts`.
- On a new note, while online, the backlinks panel says that the full list
  needs a connection. The cause is the 404 of the backlinks read before the
  first save.
- The dialog of keyboard shortcuts is taller than an 800 px screen, so its
  title is not visible.

## Finding 12: names, search and history

- A new note is named New note, New note 2 and so on. Its name does not
  follow its first heading, as it does in Bear and Apple Notes.
- A result of the command palette shows its excerpt as raw Markdown, with
  `**` marks and full link addresses. A result does not show its folder.
- History offers Restore only. A version has no preview and no difference
  with the current text, and two rows can both say "Saved just now".

## Finding 13: the file tree

- The menu of a note row has one item.
- No row has a context menu, no row renames with F2, and no selection holds
  more than one row.
- The All notes list renders every row with no virtualization. With 1010
  notes the page holds 11582 elements.

## Finding 14: editing details

- A typed fence opener and Enter do not close the fence, so every line below
  reads as code until the person closes it.
- Shift + Home on a list line selects the marker. A URL pasted over that
  selection wraps the marker in the link.
- No slash menu inserts a block.
- On the Settings page, the disabled Save button reads as a grey primary
  button.
- On a phone screen, the format row is at the top of the note, not above the
  keyboard, and shows 8 of the 15 tools.

## What is strong

- The content policy of `apps/server/src/plugins/security-headers.ts` uses
  script hashes, no inline script, and `frame-ancestors 'none'`.
- Two tabs that edited one note at the same time merged both edits.
- An edit made offline reached the server when the connection came back.
- A pasted Markdown document came back from the server byte for byte.
- A paste of HTML became clean Markdown.
- Tables, alerts, display math and diagrams render well in the editor, in
  light and in dark.
- Every icon action has a name, and the page starts with a skip link.

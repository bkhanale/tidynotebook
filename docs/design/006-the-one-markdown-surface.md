# 006: The one Markdown surface

Status: active

This design states why the note screen has two readers of one note today, and
how it becomes one live surface that a person both reads and writes.

## The problem

The note screen shows one note through two surfaces. The live preview editor
in `packages/editor` is the default surface. Read mode in
`apps/web/src/features/editor/note-read-mode.tsx` is the second surface. A
header toggle and the key `Cmd or Ctrl + Shift + P` switch between them, and
the command palette offers the same switch through `toggleReadMode` in
`apps/web/src/features/editor/note-actions.tsx`.

The two surfaces overlap almost completely. The live preview already renders
in place: it hides the markers of a heading, of bold, of italic, of strike
through, and of a link, it draws a real checkbox for a task, it draws one
bullet at every depth, it styles a block quote and a table, and it renders an
image, a Mermaid diagram, inline math, and display math as widgets. Read mode
renders the same note to sanitized HTML through `renderMarkdown` in
`packages/markdown`. The only visible difference is that Read mode draws a
table as a bordered HTML table and draws a block quote and a code block as
block level HTML, while the live preview keeps a table and a quote as styled,
editable text. So the toggle asks a person to leave the surface they edit on
to gain a small change in the look of a few constructs.

Decision record 0003 created Read mode for a different reason than the reader.
At that time `renderMarkdown` had no user, and a renderer with no user drifts
away from the editor. The equivalence gate now holds the two paths equal:
`tests/integration/markdown-equivalence.test.ts` reads the shared corpus in
`packages/markdown/test-data/content.ts` through both `renderMarkdown` and the
live preview builder, and it fails when the two disagree on structure. The
anti drift job that Read mode was built for no longer needs a surface a person
sees.

Three faults make the live surface feel unfinished, not the split alone. A
fenced code block still shows its ` ``` ` lines and its info string, against
the promise in decision 0002 that a code fence hides its fence lines; this is
the open row MD-25, QA-25 in the release list. The block styling of a quote, a
table, and a code block is plain. The heading rhythm and the reading measure
are correct but were tuned for a surface a person leaves, not for the one
surface a person stays on.

One capability that Read mode holds is real. The live preview always shows the
source, so a note that is too large or too deeply nested to render never blocks
the person: the source stays editable. Read mode carries an error state for
that case. One surface removes that error state, because the source is always
present.

## The options

**Option A. Keep both surfaces and redesign the toggle.** The duplication
stays. Two render paths stay. Two `innerHTML` hosts stay under the content
policy. The person still leaves the edit surface to read. This option polishes
the split instead of removing it, so it does not answer the request.

**Option B. One live surface. Remove Read mode.** The live preview is the only
reader and the only writer. `renderMarkdown` keeps its role as the reference
oracle of the equivalence gate, and it stays available to export, to the server
index, and to a future share page, which are the readers that need HTML rather
than an editor. The cost is that a table reads as aligned, editable text on
every surface and never as a bordered HTML table, because decision 0002 keeps a
table as editable text. This is a deliberate divergence from Obsidian for the
table construct alone, and it follows the choice to keep the closed widget set
of decision 0002.

**Option C. One live surface, with a reading view on demand.** The default is
the live surface, and a command opens a full render of the note as a read only
overlay. This keeps a second render path and its content policy surface for a
view that a person opens rarely. It hedges the divergence in Option B at the
price of the duplication that Option B removes.

This design takes Option B. The request is one surface like Obsidian, and the
priority is a renderer that always works. Option B is the one option that
removes the split, removes a render path, and removes the large note error
state, and it keeps the renderer honest through the equivalence gate rather
than through a surface that repeats the editor.

## Is one surface enough

One surface is enough when the live preview renders every construct that a
reader needs, and when the deltas against the rendered HTML are a deliberate
choice rather than a gap. The deltas are three, and each is a choice.

A table renders as aligned, editable text rather than a bordered HTML table.
Decision 0002 makes this choice for editability, and this design keeps it.

A block quote and a code block render with text decorations and line
backgrounds rather than a block level HTML element. This is the same choice as
the table, and the polish work below makes the decorated form read as well as
the HTML form.

The generated footnote section that `renderMarkdown` moves to the end of the
document has no equivalent in the live preview, which keeps a footnote in
place. The equivalence gate already excludes that section for the same reason,
so it is a rendering choice about placement and not a missing construct.

Every other construct already renders in the live surface: the heading, the
emphasis set, the link, the image, the task box, the bullet and ordered list,
inline and display math through KaTeX, and the Mermaid diagram in its isolated
frame. Fenced code is already highlighted in place through
`packages/editor/src/language.ts`. So the surface is enough once the fence
lines hide and the block styling is polished.

## The changes

**Remove the second surface.** Delete `note-read-mode.tsx` and the mode state,
the header toggle, and the `Cmd or Ctrl + Shift + P` handler in
`apps/web/src/features/editor/note-editor.tsx`. Remove `toggleReadMode` from
`note-actions.tsx` and the "Toggle Read mode" action from
`apps/web/src/shell/shell.tsx`. Remove the shortcut row for the switch in
`packages/editor/src/keymaps.ts`. Remove the Read mode `innerHTML` exception
from `apps/web/AGENTS.md`, so the sandboxed diagram frame is the only host left.
Mermaid and math keep their widgets in the live surface, so no rendered
capability is lost.

**Close the live preview gaps, inside decision 0002.** Hide the fence lines and
the info string of a fenced code block in `packages/editor/src/live-preview.ts`,
which closes MD-25, QA-25. Polish the block styling of a quote, a table, and a
code block, and the heading rhythm, in the typed adapter
`packages/editor/src/editor-theme.ts` and the note surface variables in
`apps/web/src/tailwind.css`. Every value stays a central theme variable, so a
theme change still repaints the surface with no rebuild.

**Keep the renderer as the oracle.** `renderMarkdown` stays in
`packages/markdown`, and the equivalence gate stays the guard that holds the
live preview correct. The renderer keeps no surface that a person sees.

## Risks

The equivalence gate compares structure, not appearance, so it does not catch a
styling regression on the one surface. A browser journey must read a note on
the single surface and check the heading, the code, the task, and the table, in
place of the retired `tests/e2e/mode-parity.spec.ts`.

A person who valued the bordered HTML table of Read mode loses it. This design
accepts that cost under decision 0002 and states it here so the owner accepts it
with the design.

The math widget and the diagram frame must render on the single surface exactly
as they render today. They already do, because the widgets live in the editor,
not in Read mode. The corpus and a browser journey hold this.

## Decisions

- [0025. The live preview is the one note surface](../decisions/0025-the-live-preview-is-the-one-note-surface.md)

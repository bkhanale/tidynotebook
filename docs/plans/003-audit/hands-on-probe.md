# NotesApp hands-on probe, v0.1 launch review

Commit 40eebba, branch main. Production build (`pnpm build`) served by the real
Fastify app against a disposable PostgreSQL database (project `notesapp-test`,
port 55432). Chromium 1.63.0 through Playwright, 1440x900 desktop and 390x844
phone, light and dark. The production Compose stack was not touched.

How the stack was started: `tools/test-database/ensure-postgres.sh`, then
`startE2EStack('probe', false)` from `tests/e2e/support/stack.ts` in a small
script, so the database was empty and the real setup screen was used. All probe
scripts were run from a temporary scratch directory outside the repository.

## Summary

As a first-time user the app looks clean and starts fast, but it does not yet
behave like a text editor. Twice I typed a sentence and it went nowhere: once
after clicking the empty area under the first line of a new note, once after
clicking a rendered table. Nothing on screen ever tells me whether my work is
saved, which is strange in an app whose whole model is an explicit Save. The
rich rendering that the README advertises is partly dead: Mermaid never renders
and logs three console errors per note, math renders without the KaTeX
stylesheet so a fraction shows as "31", and inline math is promoted to a
full-width block that cuts a sentence into three pieces. Names, deletion and
purge leak internal language: raw UUIDs, `path_conflict`, `stale_head`. On a
phone there is no way to search and no way to tick a task.

Three worst problems: (1) keystrokes are silently discarded in two common
click positions, (2) no visible save state anywhere, (3) advertised Markdown
rendering is broken for diagrams and math.

## Findings

| ID    | Sev | Journey       | What I did                                                                                                          | What happened                                                                                                                                                                                                                                                                                                                                                                 | What I expected                                                                                                    | Screenshot                                  |
| ----- | --- | ------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| QA-01 | P0  | 2, 4 editing  | Opened a new note, clicked 300 px below the first line, typed a sentence                                            | Focus went to the wrapper `div[role=textbox][tabindex=-1]` (`min-h-96`, 848x384) while `.cm-content` is only 27.6 px tall. The note stayed empty and every keystroke was lost                                                                                                                                                                                                 | Clicking anywhere in the note body puts the caret on the nearest line and typing works                             | j19-01-empty-note-click-area.png            |
| QA-02 | P0  | 4 editing     | Clicked a cell of a rendered table, then typed `ZZMARKER`                                                           | `document.activeElement` became `DIV.notes-rich`; the text was not inserted anywhere in the document (checked the whole scroll range). Double click did not reveal the source either                                                                                                                                                                                          | The caret lands in the table source, or the block opens for editing                                                | j4e-01, j4e-02, j4e-03                      |
| QA-03 | P0  | 5 save        | Typed, pressed Save, edited again, reloaded                                                                         | The screen is identical before and after Save. The only signal is the `data-save-state` attribute (`saved-local` then `saved-server`). `save-status.tsx` renders only on failure                                                                                                                                                                                              | A visible saved or unsaved state with the time of the last version, and a warning before leaving with unsaved work | j5-02, j5-03, j5-04                         |
| QA-04 | P1  | 4 markdown    | Added a ` ```mermaid ` block                                                                                        | The block is an empty dark box for about 5 s, then "Diagram rendering timed out, so the source stays editable." The sandboxed iframe has origin `null`, so `/assets/diagram-*.js`, `frame-*.js` and `preload-helper-*.js` are refused: "blocked by CORS policy: No 'Access-Control-Allow-Origin' header". 3 console errors per note                                           | The diagram renders, or a clear message says diagrams are not available                                            | j18-01, j18-02                              |
| QA-05 | P1  | 4 markdown    | Added `$$\int_0^1 x^2 \, dx = \frac{1}{3}$$`                                                                        | KaTeX markup renders but its stylesheet is absent: `grep -c katex apps/web/dist/web/assets/main-*.css` is 0 and no KaTeX font ships. The formula reads "∫01 x2 dx = 31"                                                                                                                                                                                                       | Correct KaTeX layout, or plain source                                                                              | j4-scroll-2, j14-note-light-viewport-lower  |
| QA-06 | P1  | 4 markdown    | Wrote `Inline math $E = mc^2$ inside a sentence.`                                                                   | The math became a full-width bordered block with its own "Show source" button, so the sentence renders as three stacked pieces: "Inline math", the box, " inside a sentence."                                                                                                                                                                                                 | Inline math stays inline                                                                                           | j4-scroll-2                                 |
| QA-07 | P1  | 4 markdown    | Wrote the two thematic breaks `---` and `***`                                                                       | `---` stays literal text; `***` is parsed as emphasis, so the line renders as a single stray `*`. The screen no longer matches the source                                                                                                                                                                                                                                     | Both render as a rule, or both stay as source                                                                      | j4-scroll-1                                 |
| QA-08 | P1  | 4 editing     | Clicked the `[ ]` box of a task line (with the line in view, correct coordinates)                                   | Nothing changed. `Ctrl+Enter` does toggle. The mouse handler looks for a task span that the scanner never emits, so mouse toggling is dead code, and a phone has no Ctrl+Enter                                                                                                                                                                                                | Clicking or tapping the box toggles the task                                                                       | j4c-04, j4c-05, j4c-06                      |
| QA-09 | P1  | 4 editing     | Selected a line and pressed Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+F                                                          | No change to the document and no panel. There is no bold, italic, link or find command in the editor at all. Ctrl+F falls back to the browser find, which only sees the rendered window of a long note                                                                                                                                                                        | Standard formatting shortcuts and a find inside the note                                                           | j4c-10 to j4c-13                            |
| QA-10 | P1  | 3 naming      | Named a second note `thing` while `thing.md` existed, pressed Save                                                  | Server 409. Red pill "[error] Save failed", "The note stays open with its text. Copy it before you close the tab.", "Copy note text", plus a raw sidebar line "Local work is preserved: f88131d5-... (path_conflict)". Nothing says the name is in use; two identical rows sit in the tree                                                                                    | Warn about the duplicate name before saving and offer a rename                                                     | j3b-04                                      |
| QA-11 | P1  | 3 naming      | Cleared the note name, then pressed Save                                                                            | The name error appears, yet the empty name is applied: the tree row loses its label and the stored path becomes `.md`. Save is not disabled and reaches `saved-local`                                                                                                                                                                                                         | Keep the last valid name and refuse the save                                                                       | j3-07, j3b-03                               |
| QA-12 | P1  | 9 purge       | Purged `thing.md` from the purge screen, reloaded                                                                   | "Purged 1 file(s)" but the purge Files list, the sidebar tree and the note grid still list it after a full reload, and opening it shows an empty note. `GET /api/workspaces/<id>/files` no longer returns it, so the client cache never drops it                                                                                                                              | The purged note disappears everywhere                                                                              | j15-purge-done, j16-01, j16-02              |
| QA-13 | P1  | 9 delete      | Deleted a note, then looked for it                                                                                  | It vanished from the tree. `/recovery` says "No kept work for this account in this workspace."; the purge screen does not list it; the workspace grid does not show it. There is no trash and no undo                                                                                                                                                                         | An undo, or a visible deleted-notes list                                                                           | j8910-14, j8910-15, j8910-16                |
| QA-14 | P1  | 11 offline    | `context.setOffline(true)`, edited, saved, reloaded                                                                 | Editing and saving work and survive the reload, but nothing on screen says the app is offline. After the offline reload a red line claims "Sync stopped: this account lost access to the workspace."                                                                                                                                                                          | An offline badge, and a message about the network rather than about lost access                                    | j11-02, j11-04, j11-05                      |
| QA-15 | P1  | 12 phone      | Looked for search at 390x844                                                                                        | The header search is hidden below the `sm` breakpoint and the only other entry is Ctrl+O, which a phone cannot press. There is no way to search on a phone                                                                                                                                                                                                                    | A search entry point on the phone layout                                                                           | j12-03, j12-11                              |
| QA-16 | P1  | 12 phone      | Loaded any screen at 390 px                                                                                         | `scrollWidth` 401 vs `clientWidth` 390: the page scrolls sideways and the account icon in the header is clipped                                                                                                                                                                                                                                                               | No horizontal overflow at 390 px                                                                                   | j12-03, j12-07                              |
| QA-17 | P1  | 13 delivery   | `curl -H 'Accept-Encoding: gzip, br'` on the built assets                                                           | No `content-encoding`, no `cache-control`, no `content-length`, no `etag`, no security headers. The login route downloads 488,615 bytes of raw JS; the same files gzip to 146 KB                                                                                                                                                                                              | Compressed, cacheable assets and basic security headers                                                            | see Performance                             |
| QA-18 | P1  | 6 history     | Opened history after six saves                                                                                      | Entries read "Revision 3ada387d-c5c9-4994-9b52-587e9fd2b861, saved 2026-09-10T13:17:06.001Z, checkpoint Manual save". All six look the same. The same six appear again under "Pending history on this device" marked "(saved to server)"                                                                                                                                      | Human times, a short label, a preview of the change, and no duplicate list                                         | j67-01, j67-02                              |
| QA-19 | P1  | 6 history     | Restored an old revision, then named a checkpoint                                                                   | The restore worked and explained itself well, but the checkpoint failed with a raw error: "stale_head: The accepted head of a file has moved on." (HTTP 412). The action was lost                                                                                                                                                                                             | The checkpoint uses the new head, or the message says to reload                                                    | j67-03, j67-04                              |
| QA-20 | P1  | 4 a11y        | Inspected the editor                                                                                                | Two nested `role="textbox"` elements for one editor (the `min-h-96` wrapper and `.cm-content`), the outer one with `tabindex="-1"` and the label "Note New note 2"                                                                                                                                                                                                            | One text box in the accessibility tree                                                                             | j19-01                                      |
| QA-21 | P2  | 1 setup       | Submitted the first-run form empty, with a bad address, and with a 3-character password                             | Empty and malformed input are caught only by native browser bubbles. The 12-character rule appears only after a failed round trip, as "The account could not be created. Use at least 12 password characters." No autofocus, no show-password, and nothing says this is the one-time owner setup. The label is just "Address"                                                 | Requirements stated up front, focus in the first field, and a first-run explanation                                | 02-j1-setup-screen, 06-j1-short-password    |
| QA-22 | P2  | 2 empty state | Looked at a brand new workspace                                                                                     | Four "New note" buttons at once (header, sidebar, page header, empty card), the card button stretched to full width, and two vocabularies: "FILES 0" plus "No files yet." next to "0 notes" plus "No notes yet in this workspace."                                                                                                                                            | One clear primary action and one vocabulary                                                                        | 01-j2-landing-after-setup                   |
| QA-23 | P2  | 4 markdown    | Wrote headings h1 to h6                                                                                             | Levels 3 to 6 share one style, and h1 is barely larger than h2, so six levels read as three                                                                                                                                                                                                                                                                                   | A visible scale for every level                                                                                    | j4-scroll-0                                 |
| QA-24 | P2  | 4 markdown    | Wrote a three-level bullet list                                                                                     | The bullet is replaced by "•" at the first two levels only; the third level keeps a raw "-"                                                                                                                                                                                                                                                                                   | Consistent bullets at any depth                                                                                    | j4-scroll-1                                 |
| QA-25 | P2  | 4 markdown    | Wrote a table with `:---`, `:---:`, `---:`                                                                          | The table renders but every cell is left aligned; the alignment row is ignored                                                                                                                                                                                                                                                                                                | Alignment is honoured                                                                                              | j4-scroll-1                                 |
| QA-26 | P2  | 4 markdown    | Wrote `<https://example.com/pointy>`, a bare URL and `<someone@example.com>`                                        | All three stay raw source with visible angle brackets and are not clickable                                                                                                                                                                                                                                                                                                   | Autolinks render as links                                                                                          | j4-scroll-0                                 |
| QA-27 | P2  | 4 markdown    | Clicked and Ctrl+clicked `[normal link](https://example.com/page)`                                                  | Plain click only moves the caret; Ctrl+click reports "That link target opens in a later task." No external link can be opened                                                                                                                                                                                                                                                 | Ctrl+click opens the target                                                                                        | j4b-06                                      |
| QA-28 | P2  | 4 markdown    | Wrote `[[Another Note]]`                                                                                            | It renders underlined like a working link, but activating it says "resolves in a later task."                                                                                                                                                                                                                                                                                 | Either resolve it or do not style it as a link                                                                     | j4-scroll-3                                 |
| QA-29 | P2  | 4 markdown    | Wrote a footnote, a setext heading, an indented code block, raw HTML, and inline code                               | Footnotes, setext headings, indented code and raw HTML stay as source (the `<script>` is inert, which is right). Inline code and code fences always show their backticks, while bold, italic and link markers hide, so marker behaviour is inconsistent                                                                                                                       | One rule for markers, and a stated scope for unsupported syntax                                                    | j4-scroll-0 to j4-scroll-3                  |
| QA-30 | P2  | 4 markdown    | Added `![Broken image](https://example.invalid/missing.png)` and clicked "Load"                                     | A 140 px box says "External image Broken image needs an explicit load." with two link-styled controls. After Load nothing changes and no error appears                                                                                                                                                                                                                        | A compact placeholder and a clear failure message                                                                  | j4-scroll-0, j15-external-image-after-load  |
| QA-31 | P2  | 4 editing     | Scrolled a 102-line note                                                                                            | The page scrolls, not the editor (`.cm-scroller` scrollHeight equals clientHeight). Document height grows while scrolling (2256, then 2810, then 2860 px) and a scroll to 2400 lands at 1960. The note name and Save scroll away with no sticky header                                                                                                                        | Stable page height and a persistent note header                                                                    | j4d-01, j4d-02                              |
| QA-32 | P2  | 5 save        | Pressed Save twice with no change between                                                                           | A second identical revision is created; history fills with duplicates                                                                                                                                                                                                                                                                                                         | An unchanged Save is a no-op                                                                                       | j67-01                                      |
| QA-33 | P2  | 7 search      | Typed in the header search and pressed ArrowDown                                                                    | Focus stayed in the input, no result is highlighted, and the results popup has no keyboard path. Ctrl+O quick open does support arrows and Enter                                                                                                                                                                                                                              | Arrow keys move through the results                                                                                | j67-06, j67-09                              |
| QA-34 | P2  | 8 folders     | Collapsed "Projects", then created a note                                                                           | The folder expanded again; the state is component-local and every file-list change re-expands all folders. There is also no way to create, rename or move a folder: nesting exists only if you type "/" in the note name                                                                                                                                                      | Folder state is kept, and folders can be managed                                                                   | j8910-02, j11-01, j3b-02                    |
| QA-35 | P2  | 9 purge       | Ran a purge preview and then the purge                                                                              | The preview says "reclaim 512 byte(s)", the result says "reclaimed 1024 byte(s)". The page prints UUIDs next to every file, "revision(s)" style plurals, and an unverifiable claim: "Encrypted backups keep copies until their retention ends: seven daily and four weekly copies on separate storage."                                                                       | Consistent numbers and no operator claims about the user's own install                                             | j8910-17, j15-purge-preview, j15-purge-done |
| QA-36 | P2  | 10 account    | Opened Account settings                                                                                             | The address is printed twice: "owner@probe.notes.invalid (owner@probe.notes.invalid)". The palette options are "System", "Tokyo Night Day", "Tokyo Night Night". There are two settings destinations, `/settings` and `/w/<id>/settings`                                                                                                                                      | One address, product names for palettes, one settings home                                                         | j8910-12, j14-account-settings-viewport     |
| QA-37 | P2  | 4, 10         | Checked the tab title on every screen                                                                               | `document.title` is always "Notesapp", even with a note open                                                                                                                                                                                                                                                                                                                  | The note name belongs in the title                                                                                 | j14-note-light-viewport-top                 |
| QA-38 | P2  | 3 naming      | Tried slash, leading dot, `.md`, 300 characters, unicode, emoji, backslash, `..`, control character, trailing space | Empty, spaces-only, 300 characters, backslash, `../` and a control character all give the same message: "Use a note name without empty folders, traversal, or edge spaces." It never mentions length or characters. `trailing space name ` is accepted although the message claims edge spaces are refused, and it saved as `trailing space name .md`. Unicode and emoji work | One message per cause, and no invisible trailing space in a name                                                   | j3-07 to j3-15                              |
| QA-39 | P2  | 5, 8          | Created notes and never saved some of them                                                                          | Local-only drafts sit in the tree with no marker next to server-backed notes, so the tree does not tell you what exists on the server. Combined with QA-03 there is no way to know                                                                                                                                                                                            | A marker for local-only notes                                                                                      | j14-after-sign-in-again                     |
| QA-40 | P3  | 12 phone      | Measured control heights at 390 px                                                                                  | Many controls are 32 px high or less: theme 38x32, account 32x32, Save 72x32, "History and checkpoints" 156x20                                                                                                                                                                                                                                                                | At least 44 px for primary touch targets                                                                           | j12-07                                      |
| QA-41 | P3  | all           | Watched the console during the session                                                                              | Repeated "A preload for /assets/rolldown-runtime-*.js is found, but is not used because it is a cross-world service worker resource mismatch" and "preloaded using link preload but not used"                                                                                                                                                                                 | No wasted preloads                                                                                                 | see Console                                 |
| QA-42 | P3  | 10            | Opened the shortcut guide                                                                                           | It lists only three shortcuts (open note, save note, toggle task). It does not mention Escape, and it hides the fact that bold, italic, link and find do not exist                                                                                                                                                                                                            | A complete list                                                                                                    | j8910-11                                    |
| QA-43 | P3  | 4 markdown    | Wrote a nested block quote                                                                                          | The outer quote gets a bar, but the inner `>` shows as literal text inside the quote                                                                                                                                                                                                                                                                                          | Nested quotes nest                                                                                                 | j4-scroll-1                                 |
| QA-44 | P3  | 3 naming      | Typed `thing.md` as the note name                                                                                   | The stored path is `thing.md` and the tree shows "thing", but the name field keeps showing "thing.md" until a reload, so two names for one note are on screen                                                                                                                                                                                                                 | Normalise the field at once                                                                                        | j3b-01                                      |

## Markdown rendering in the editor

| Feature                             | Rendered   | Notes                                                                                |
| ----------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| ATX heading h1, h2                  | yes        | Sizes are close to each other                                                        |
| ATX heading h3 to h6                | partial    | One shared style for four levels                                                     |
| Setext heading                      | no         | Text and the `===` line stay as source                                               |
| Bold, italic, strikethrough         | yes        | Markers hide when the cursor is away                                                 |
| Inline code                         | partial    | Renders, but the backticks are always visible                                        |
| Inline link                         | yes        | Label styled, target hidden, but it cannot be opened (QA-27)                         |
| Autolink pointy, bare, email        | no         | Raw source, not clickable                                                            |
| Image, external URL                 | partial    | Placeholder plus a "Load" control; a broken URL gives no error                       |
| Image, attachment                   | not tested | Needs an uploaded attachment                                                         |
| Ordered list, nested                | yes        | Numbers kept, indent preserved                                                       |
| Unordered list                      | partial    | "•" at two levels only, raw "-" deeper                                               |
| Task list, checked and unchecked    | partial    | `[ ]` and `[x]` shown as text, no checkbox, mouse toggle dead (QA-08)                |
| Block quote                         | yes        | Left bar plus italic text                                                            |
| Nested block quote                  | wrong      | Inner `>` leaks as text                                                              |
| Fenced code with language           | partial    | Body tinted per line with a ragged edge, fence lines visible, no syntax highlighting |
| Fenced code without language        | partial    | Same as above                                                                        |
| Indented code                       | no         | Plain indented text                                                                  |
| Table with alignment                | partial    | Table renders, alignment ignored (QA-25)                                             |
| Thematic break `---`                | no         | Literal text                                                                         |
| Thematic break `***`                | wrong      | Parsed as emphasis, shows a stray `*` (QA-07)                                        |
| Footnote reference and definition   | no         | Raw `[^note]`                                                                        |
| Inline math                         | wrong      | Promoted to a block (QA-06) and unstyled (QA-05)                                     |
| Block math                          | wrong      | Unstyled KaTeX markup, "= 31" for a third                                            |
| Mermaid diagram                     | no         | Empty box, then a timeout message; CORS blocks the chunks (QA-04)                    |
| Raw inline HTML `<b>`               | no         | Literal text, by design                                                              |
| Raw block HTML, `<script>`          | no         | Literal text and inert. Safe                                                         |
| Hard break, two spaces or backslash | n/a        | Source lines are preserved, nothing to render                                        |
| Very long line                      | yes        | Wraps cleanly, no horizontal scroll                                                  |
| Emoji, CJK, accents                 | yes        | Correct                                                                              |
| Wiki link `[[…]]`                   | partial    | Styled as a link, not resolvable (QA-28)                                             |

Cursor behaviour: with the cursor away, markers hide as intended; with the
cursor on a line, that line falls back to raw source, which reads well. Clicking
heading text, a bullet, or a bold word puts the caret exactly where I clicked.
Clicking a rich widget is the failure case (QA-02). Enter continues a bullet
list, Enter after a heading starts plain text, Enter inside a fence stays inside
the fence, and Tab indents a list item; undo and redo are correct. Live preview
decorates only the rendered window, so a construct far down the note has no
widget until it scrolls near.

## Performance

Loopback, so treat the network part as zero.

| Measure                                                         | Value                                            |
| --------------------------------------------------------------- | ------------------------------------------------ |
| Cold load of `/login`: first paint                              | 28 ms                                            |
| Cold load of `/login`: first contentful paint                   | 116 ms                                           |
| Cold load of `/login`: form visible (wall clock)                | 132 ms                                           |
| domContentLoaded and load event                                 | 40 ms                                            |
| JS on the login route                                           | 4 files, 488,615 bytes transferred, uncompressed |
| Biggest chunks                                                  | hooks 264,535 B, main 216,102 B                  |
| The same two files gzipped on disk                              | 78,736 B and 67,405 B (about 146 KB total)       |
| CSS on the login route                                          | 25,360 bytes, uncompressed                       |
| Total transferred, login route                                  | 514,899 bytes                                    |
| Signed-in route                                                 | 7 JS files, 526,559 bytes decoded                |
| Warm reload signed in, file tree visible                        | 820 ms                                           |
| 5,000-line note (289,661 chars): reopen to first rendered lines | 46 ms                                            |
| 5,000-line note: save to `saved-server`                         | under 3 s                                        |
| Typing latency in that note (25 samples, two frames each)       | min 26 ms, p50 33 ms, p95 34 ms, max 37 ms       |
| `notesapp.typing-handler` User Timing in that note              | 0.00 to 0.10 ms                                  |
| Rendered `.cm-line` elements in that note                       | 100 of 5,000                                     |
| Document height of that note                                    | 98,301 px                                        |

Reading: the app is fast. Typing in a 5,000-line note is limited by frame
timing, not by the handler. The one real number to fix is delivery: 489 KB of
raw JS with no compression and no cache headers (QA-17), and the login screen
alone pulls the whole editor-adjacent bundle.

## Console errors and warnings

Collected over the whole session and normalised (host and UUIDs masked).

| Count   | Message                                                                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 each | `Access to script at '/assets/diagram-*.js' from origin 'null' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.` Same for `frame-*.js` and `preload-helper-*.js` (QA-04) |
| 11 each | `requestfailed: /assets/diagram-*.js net::ERR_FAILED`, same for `frame-*.js` and `preload-helper-*.js`                                                                                                                                 |
| 40      | `Failed to load resource: net::ERR_FAILED` (the same blocked chunks and the offline period)                                                                                                                                            |
| 9       | `Failed to load resource: the server responded with a status of 401 (Unauthorized)` (expected `GET /api/account` before sign-in)                                                                                                       |
| 4       | `A preload for '/assets/rolldown-runtime-*.js' is found, but is not used because it is a cross-world service worker resource mismatch.` (QA-41)                                                                                        |
| 2       | `The resource /assets/rolldown-runtime-*.js was preloaded using link preload but not used within a few seconds from the window's load event.`                                                                                          |
| 2       | `Failed to load resource: ... 409 (Conflict)` (duplicate note name, QA-10)                                                                                                                                                             |
| 1       | `Failed to load resource: ... 412 (Precondition Failed)` (checkpoint after restore, QA-19)                                                                                                                                             |
| 1       | `Failed to load resource: ... 400 (Bad Request)` (short password, expected)                                                                                                                                                            |
| 3       | `requestfailed: /api/workspaces` and `/api/account net::ERR_FAILED` (during the offline test, expected)                                                                                                                                |

No uncaught page errors were seen at any point.

## Screenshots

All files are in
The screenshots were kept outside the repository in a temporary scratch directory during the audit session.

Setup and empty state: `01-j1-first-run-root.png`, `02-j1-setup-screen.png`,
`03-j1-empty-submit.png`, `04-j1-invalid-typed.png`,
`05-j1-invalid-email-short-password.png`, `06-j1-short-password.png`,
`01-j2-landing-after-setup.png`, `02-j2-landing-before-theme-probe.png`.

Names: `j3-01-new-note-blank.png`, `j3-02-renamed-valid.png`,
`j3-03-name-slash.png`, `j3-04-name-leading-dot.png`, `j3-05-name-dot-md.png`,
`j3-06-name-other-ext.png`, `j3-07-name-empty.png`,
`j3-08-name-spaces-only.png`, `j3-09-name-long.png`, `j3-10-name-unicode.png`,
`j3-11-name-emoji-only.png`, `j3-12-name-backslash.png`,
`j3-13-name-dotdot.png`, `j3-14-name-trailing-space.png`,
`j3-15-name-control-char.png`, `j3b-01-dot-md-saved.png`,
`j3b-02-nested-folder.png`, `j3b-03-save-with-invalid-name.png`,
`j3b-04-duplicate-name.png`.

Markdown document: `j4-01-doc-cursor-at-end-fullpage.png`, `j4-scroll-0.png` to
`j4-scroll-7.png`, `j4b-01-cursor-on-heading.png`,
`j4b-02-cursor-on-bold-line.png`, `j4b-03-click-on-rendered-table.png`,
`j4b-04-table-source-revealed.png`, `j4b-05-after-task-click.png`,
`j4b-06-after-plain-link-click.png`, `j4c-01-cursor-on-heading-two.png`,
`j4c-02-cursor-inside-bold.png`, `j4c-03-cursor-in-table-source.png`,
`j4c-04-task-before-click.png`, `j4c-05-task-after-click.png`,
`j4c-06-task-after-ctrl-enter.png`, `j4c-07-enter-in-list.png`,
`j4c-08-tab-in-list.png`, `j4c-09-enter-in-code-fence.png`,
`j4c-10-after-Control-B.png`, `j4c-11-after-Control-I.png`,
`j4c-12-after-Control-K.png`, `j4c-13-after-Control-F.png`,
`j4c-14-after-undo-redo.png`, `j4d-01-reopened-top.png`,
`j4d-02-reopened-scrolled.png`, `j4e-01-after-click-table-cell.png`,
`j4e-02-after-typing-into-table-click.png`, `j4e-03-after-dblclick-table.png`,
`j18-01-mermaid-viewport.png`, `j18-02-mermaid-closeup.png`,
`j19-01-empty-note-click-area.png`.

Save flow: `j5-01-widget-enter-reveals-source.png`,
`j5-02-after-typing-unsaved.png`, `j5-03-after-save.png`,
`j5-04-after-edit-following-save.png`, `j5-05-after-reload-without-saving.png`,
`j5-06-after-reload-following-save.png`, `j5-07-after-ctrl-s.png`.

History and search: `j67-01-history-list.png`,
`j67-02-history-revision-selected.png`, `j67-03-history-after-restore.png`,
`j67-04-history-named-checkpoint.png`, `j67-05-note-after-restore.png`,
`j67-06-search-results.png`, `j67-07-search-after-enter.png`,
`j67-08-search-no-results.png`, `j67-09-quick-open.png`,
`j67-10-quick-open-filtered.png`, `j67-11-quick-open-arrow.png`,
`j67-12-quick-open-opened.png`.

Sidebar, theme, delete, recovery, purge: `j8910-01-sidebar-with-folders.png`,
`j8910-02-folder-collapsed.png`, `j8910-03-long-note-name.png`,
`j8910-04-outline-open.png`, `j8910-05-backlinks-open.png`,
`j8910-06-dark-theme-note.png`, `j8910-07-dark-theme-workspace.png`,
`j8910-08-dark-theme-markdown-top.png`, `j8910-09-dark-theme-markdown-mid.png`,
`j8910-10-dark-theme-markdown-lower.png`,
`j8910-11-keyboard-shortcuts-dialog.png`, `j8910-12-account-settings.png`,
`j8910-13-before-delete.png`, `j8910-14-delete-confirm-state.png`,
`j8910-15-after-delete.png`, `j8910-16-recovery-screen.png`,
`j8910-17-purge-screen.png`, `j15-purge-file-selected.png`,
`j15-purge-preview.png`, `j15-purge-done.png`,
`j15-after-purge-workspace.png`, `j15-external-image-after-load.png`,
`j15-insert-link-no-selection.png`, `j16-01-open-purged-note.png`,
`j16-02-workspace-cards.png`.

Offline: `j11-01-folder-state-after-create.png`,
`j11-02-offline-just-switched.png`, `j11-03-offline-after-typing.png`,
`j11-04-offline-after-save.png`, `j11-05-offline-after-reload.png`,
`j11-06-online-again.png`, `j11-07-online-after-reload.png`,
`j11-08-offline-status-route.png`.

Phone 390x844: `j12-01-phone-setup.png`, `j12-02-phone-setup-filled.png`,
`j12-03-phone-landing.png`, `j12-04-phone-drawer-open.png`,
`j12-05-phone-drawer-closed.png`, `j12-06-phone-new-note.png`,
`j12-07-phone-note-typed.png`, `j12-08-phone-after-save.png`,
`j12-09-phone-note-scrolled.png`, `j12-10-phone-quick-open.png`,
`j12-11-phone-drawer-on-note.png`.

Performance and sessions: `j13-01-big-note-top.png`,
`j13-02-big-note-reopened.png`, `j13-03-big-note-scrolled.png`,
`j14-workspace-light-viewport.png`, `j14-note-light-viewport-top.png`,
`j14-note-light-viewport-mid.png`, `j14-note-light-viewport-lower.png`,
`j14-note-dark-viewport-top.png`, `j14-note-dark-viewport-mid.png`,
`j14-note-dark-viewport-lower.png`, `j14-workspace-dark-viewport.png`,
`j14-focus-on-note.png`, `j14-account-settings-viewport.png`,
`j14-after-sign-out.png`, `j14-login-again.png`,
`j14-login-wrong-password.png`, `j14-after-sign-in-again.png`.

## What worked well

Setup to first note takes about 1.1 s. Drafts survive a reload and an offline
reload, and a queued save syncs on reconnect without any conflict screen. The
restore path is safe and explains itself. Quick open is good. Dark mode is
complete on every screen I visited. A 5,000-line note stays fast. Raw HTML and
`<script>` in a note are inert. Long names truncate cleanly in the tree, and
unicode and emoji names work.

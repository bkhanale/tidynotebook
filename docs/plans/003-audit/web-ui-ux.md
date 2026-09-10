# Web UI and UX audit

Scope: `apps/web/src` (app, router, shell, features, local state, platform, pwa),
`packages/ui`, `apps/web/src/tailwind.css`, `apps/web/index.html`,
`apps/web/vite.config.ts`, and `tests/e2e`. The CodeMirror internals and the
Markdown renderer internals are out of scope.

## Summary

The application is feature complete against the README, but it is not yet a
product. It reads as an engineering console for a multi user, multi workspace,
self hosted service, not as "the best Markdown editor, simple by design".
The shell, the login screen, and the note screen have a real visual language.
Four screens (history, purge, recovery, offline status) are unstyled prototypes
that show raw UUIDs and raw ISO timestamps.
The three biggest problems are:

1. The explicit Save model has no visible state. `SaveStatus` renders nothing
   unless persistence fails, so Save gives no confirmation and unsaved work has
   no marker. The only save signal is a `data-save-state` attribute for tests.
2. The information architecture carries a large amount of scope that a single
   user cannot use (workspaces, roles, purge, recovery, agent tokens) while the
   basics are missing (trash and undo, move, recent order, export, one command
   palette). A deleted note cannot be recovered through the interface.
3. Attachments are treated as notes in the sidebar tree and in Quick open, so a
   normal paste of an image creates tree entries that open a broken empty
   editor over an attachment file.

## Findings

| ID    | Sev | Area          | Finding                                                                                                                                                                                                                                                                                                                                                                                    | Location                                                                                                                                                                                 | Recommended fix                                                                                                                                                         |
| ----- | --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-01 | P0  | Save UX       | `SaveStatus` returns `null` for every healthy state, so there is no "Saved", no "Unsaved", and no "Synced" anywhere. An explicit Save gives no confirmation.                                                                                                                                                                                                                               | `apps/web/src/features/save-status.tsx:62`, `apps/web/src/features/note-editor.tsx:713`                                                                                                  | Show a persistent, quiet state chip next to Save: "Unsaved changes", "Saving", "Saved on this device", "Synced". Keep `data-save-state` for tests.                      |
| UI-02 | P0  | Note list     | The sidebar tree and Quick open list every file kind. Attachments (`attachments/<uuid>-name.png`) appear as notes; opening one mounts the note editor on an attachment file. The grid filters correctly, the tree does not.                                                                                                                                                                | `apps/web/src/features/shell.tsx:468` and `:750` versus `:917`                                                                                                                           | Filter `kind === 'note'` in `useWorkspaceFiles`, or filter inside `buildFileTree`. Show attachments only in a note context.                                             |
| UI-03 | P0  | Delete        | Delete is a two click inline action with no trash, no undo, and no deleted list. The note leaves the tree at once. Recovery needs the owner only purge screen and a hand typed file UUID.                                                                                                                                                                                                  | `apps/web/src/features/note-editor.tsx:641`, `apps/web/src/features/purge.tsx:399`                                                                                                       | Add an undo notice after delete and a "Deleted notes" list with Restore. Keep the destructive path behind the trash.                                                    |
| UI-04 | P0  | Copy          | Unfinished work is shipped as user text: "Note link [[title]] resolves in a later task." and "That link target opens in a later task."                                                                                                                                                                                                                                                     | `apps/web/src/features/note-editor.tsx:1016`                                                                                                                                             | Either resolve wiki links for v0.1 or say what the user can do now, for example "This note link has no target yet."                                                     |
| UI-05 | P1  | Offline UX    | There is no offline indicator in the shell. Sync problems appear only in the sidebar footer, which is inside the phone drawer, so a phone user never sees them.                                                                                                                                                                                                                            | `apps/web/src/features/shell.tsx:726`                                                                                                                                                    | Put one small connection and sync state in the header, visible at every width.                                                                                          |
| UI-06 | P1  | State         | Sync state is derived by substring matching on human prose (`includes('stopped')`, `includes('retries')`). Any copy change silently breaks the condition.                                                                                                                                                                                                                                  | `apps/web/src/features/shell.tsx:536`                                                                                                                                                    | Return a typed state from `useWorkspaceSync` and select the copy in the view.                                                                                           |
| UI-07 | P1  | Copy          | Engine notices reach the user unchanged: "Local work is preserved: 7f3a... (conflict).", "Downloaded 12 revision(s) for offline use.", "Sync retries in 7 seconds.", "Sync lost its worker lease and retries."                                                                                                                                                                             | `apps/web/src/app.tsx:358` to `:390`                                                                                                                                                     | Map notices to two or three user states: "Saved to the server", "Waiting for a connection", "Needs attention". Keep IDs out of copy.                                    |
| UI-08 | P1  | Errors        | `problemMessage` prints machine codes to the user, for example "invalid_request: ...". Every failing screen shows it.                                                                                                                                                                                                                                                                      | `apps/web/src/app.tsx:52` and every `role="alert"` use                                                                                                                                   | Map known codes to plain sentences with a next action. Keep the code in a details line or in the console.                                                               |
| UI-09 | P1  | Feedback      | `session.error` ("The account is offline. Local notes remain available.") is stored and never rendered. Theme sync errors are also dropped, because `themeValue` omits `syncError`.                                                                                                                                                                                                        | `apps/web/src/app.tsx:187`, `:504`, `:511`                                                                                                                                               | Render the session error once in the shell, or delete the state. Surface or delete `syncError`.                                                                         |
| UI-10 | P1  | Search        | The search field is `hidden ... sm:flex`, so there is no search below 640 px. Quick open is keyboard only (Cmd or Ctrl plus O), so a phone or tablet user has no way to search at all.                                                                                                                                                                                                     | `apps/web/src/features/search.tsx:147`, `apps/web/src/features/shell.tsx:554`                                                                                                            | One search entry point at every width: a search icon button in the header that opens the same dialog Quick open uses.                                                   |
| UI-11 | P1  | Search        | Two different search experiences exist: a content search dropdown in the header and a path only Quick open dialog. They have different results, different copy, and different keyboard behaviour.                                                                                                                                                                                          | `apps/web/src/features/search.tsx:48` and `:210`                                                                                                                                         | Merge into one command palette that matches names first, then content, and drop the header dropdown.                                                                    |
| UI-12 | P1  | A11y          | Nested `<main>` landmarks. `NoteView` renders `<main>` and `NoteEditorLoader` renders another `<main>` for loading, unknown, purged, deleted, unavailable, and no store states.                                                                                                                                                                                                            | `apps/web/src/features/shell.tsx:1039` with `apps/web/src/features/note-editor.tsx:918`, `:924`, `:939`, `:951`, `:966`, `:977`                                                          | Let the route own one `<main>`. Child states return sections.                                                                                                           |
| UI-13 | P1  | A11y          | `Button` always writes `aria-label` from `label`, so the accessible name replaces the visible text. Several accessible names do not contain the visible label, which fails WCAG 2.5.3 Label in Name: "Confirm delete" versus "Confirm deletion of this note", "Load older entries" versus "Load older history entries", "Add the file ID" versus "Add the named file ID to the purge set". | `packages/ui/src/controls.tsx:70`, `apps/web/src/features/note-editor.tsx:745`, `apps/web/src/features/history.tsx:612`, `apps/web/src/features/purge.tsx:406`                           | Apply `aria-label` only when there are no children. For icon only buttons keep the label and add `title`.                                                               |
| UI-14 | P1  | A11y          | The danger button uses `bg-danger text-white`. In the dark palette white on `#f7768e` is 2.65 to 1, which fails AA for the label of a destructive control. `text-white` is also not a theme token.                                                                                                                                                                                         | `packages/ui/src/controls.tsx:46`, `packages/ui/src/theme.ts:99`                                                                                                                         | Add `dangerFill` and `dangerOnFill` tokens, as the accent pair already does, and use them.                                                                              |
| UI-15 | P1  | Contrast      | In the light palette the body token `text` (`#3760bf`) is 3.99 to 1 on the sidebar surface, 4.27 on hover, and 3.74 on active. The shell sets `text-ink` on the root, and the sidebar panels rely on inheritance, so outline text, backlink source text, and every unclassed paragraph in the sidebar fail AA in light mode.                                                               | `packages/ui/src/theme.ts:113`, `apps/web/src/features/shell.tsx:617` and `:715`, `apps/web/src/features/backlinks.tsx:268`, `:322`, `:336`                                              | Give the sidebar its own text token, or set `text-strong` and `text-muted` on the sidebar container and never inherit `ink` there.                                      |
| UI-16 | P1  | Dialogs       | Quick open and the shortcuts dialog have `aria-modal` but no focus trap, no focus restore, and no `inert` on the page behind. Tab leaves the dialog into the page. The shortcuts dialog never receives focus when it opens.                                                                                                                                                                | `apps/web/src/features/search.tsx:249`, `apps/web/src/features/shell.tsx:753`                                                                                                            | One `Dialog` component in `packages/ui` with Escape, a focus trap, focus restore, and a labelled title. The drawer already has this logic at `shell.tsx:567`; reuse it. |
| UI-17 | P1  | Tree          | Every file list refresh reopens all folders, because the effect sets the open set from the file list. One keystroke changes a local file summary, so a folder the user collapsed springs open again.                                                                                                                                                                                       | `apps/web/src/features/shell.tsx:344`                                                                                                                                                    | Seed the open set once per workspace and merge later changes instead of replacing the set.                                                                              |
| UI-18 | P1  | Data flow     | `useWorkspaces` is a plain hook with its own state, called by `Shell`, `Sidebar`, `NoteView`, `HistoryView`, `PurgeView`, `WorkspaceView`, `WorkspaceSettingsView`, `AccountSettingsPage`, and `AgentTokens`. Opening one note fires `listWorkspaces` three or more times.                                                                                                                 | `apps/web/src/features/workspaces.tsx:97`, call sites in `shell.tsx:317`, `:525`, `:1009`                                                                                                | Move the workspace list into one provider next to session, store, and theme.                                                                                            |
| UI-19 | P1  | Data flow     | `loadAllFiles` runs twice for the same workspace: once in the shell for the tree and once in `WorkspaceNotesView` for the grid, with duplicated pagination, merge, and error logic.                                                                                                                                                                                                        | `apps/web/src/features/shell.tsx:82` and `:858`                                                                                                                                          | One `useWorkspaceFiles` result passed down, or one provider.                                                                                                            |
| UI-20 | P1  | Loading       | `WorkspaceNotesView` never resets `loading` or `serverFiles` when `workspaceId` changes, so switching workspaces shows the previous notes as if they belong to the new workspace.                                                                                                                                                                                                          | `apps/web/src/features/shell.tsx:870` to `:910`                                                                                                                                          | Set `loading` true inside the effect, or key the component by `workspaceId`.                                                                                            |
| UI-21 | P1  | Note screen   | The role arrives after the note mounts, so `readOnly` starts true. A "Read only" badge and a disabled name field flash on every note open, and Save and Delete are missing for that moment.                                                                                                                                                                                                | `apps/web/src/features/shell.tsx:1026`, `apps/web/src/features/note-editor.tsx:775`                                                                                                      | Treat an unknown role as writable in a single user build, or render a neutral state until the role is known.                                                            |
| UI-22 | P1  | Visual        | Four screens never received the Tailwind design pass. `history.tsx`, `purge.tsx`, `recovery.tsx`, and `offline-status.tsx` use bare `ol`, `ul`, `li`, `pre`, `progress`, and `label` elements with browser defaults, next to fully styled cards elsewhere.                                                                                                                                 | `apps/web/src/features/history.tsx:594`, `:639`, `:723`, `apps/web/src/features/purge.tsx:382`, `apps/web/src/features/recovery.tsx:149`, `apps/web/src/features/offline-status.tsx:105` | Either restyle these screens with the card and list patterns of the settings screens, or cut them from v0.1 (see the inventory).                                        |
| UI-23 | P1  | History       | The history list is a stack of full width secondary buttons whose label is a sentence with a raw UUID and a raw ISO timestamp: "Revision 8f2c... , saved 2026-01-02T10:11:12.345Z". Local checkpoints print the same way.                                                                                                                                                                  | `apps/web/src/features/history.tsx:594`, `:642`, `:772`                                                                                                                                  | Render a timeline of rows: relative time, an optional checkpoint name, and one Restore action. Never show a UUID to the user.                                           |
| UI-24 | P1  | PWA           | `registerType: 'prompt'` and a worker that only calls `skipWaiting` on a message, but nothing in the interface ever prompts. `requestUpdate` and `prepareForUpdate` are never called from the application. A new version therefore never activates while the tab stays open.                                                                                                               | `apps/web/vite.config.ts:130`, `apps/web/src/pwa/lifecycle.ts:205` and `:179`, `apps/web/src/pwa/service-worker.ts:171`                                                                  | Add an "Update available" notice in the shell that calls `prepareForUpdate` and then `requestUpdate`.                                                                   |
| UI-25 | P1  | PWA           | `requestPersistentStorage` and `persistenceDenialMessage` are never called, so the README claim of durable offline drafts is not requested from the browser and a denial is never reported.                                                                                                                                                                                                | `apps/web/src/pwa/lifecycle.ts:96` and `:110`                                                                                                                                            | Request persistence once after the first save and show the denial message in the shell.                                                                                 |
| UI-26 | P2  | A11y          | The editor host is a `div` with `role="textbox"`, `aria-label`, and `tabIndex={-1}` wrapped around CodeMirror, which exposes its own textbox. Nested textbox roles confuse screen readers.                                                                                                                                                                                                 | `apps/web/src/features/note-editor.tsx:783`                                                                                                                                              | Remove the role from the wrapper and let the CodeMirror content element own the name.                                                                                   |
| UI-27 | P2  | A11y          | The drawer overlay carries `aria-hidden="true"` and a click handler, and the drawer sets `role="dialog"` on the `aside`, which removes the complementary landmark while open. Siblings are not inert.                                                                                                                                                                                      | `apps/web/src/features/shell.tsx:707`, `:712`                                                                                                                                            | Use a `button` or a plain overlay without `aria-hidden`, and mark header and content inert while the drawer is open.                                                    |
| UI-28 | P2  | A11y          | No reduced motion handling anywhere. The drawer slide, the card transitions, and `active:scale-95` on every button always run.                                                                                                                                                                                                                                                             | `packages/ui/src/controls.tsx:55`, `apps/web/src/features/shell.tsx:715`                                                                                                                 | Wrap motion in `motion-safe:` or add one reduced motion rule in the theme layer.                                                                                        |
| UI-29 | P2  | A11y          | Non text contrast: `borderSubtle` is 1.08 to 1.66 to 1 on every surface in both palettes, while the module doc claims every border token meets 3 to 1. It is used for card, dialog, header, and sidebar boundaries.                                                                                                                                                                        | `packages/ui/src/theme.ts:5`, `:102`, `:125`                                                                                                                                             | Either raise `borderSubtle` for boundaries that identify a component, or keep it decorative and use `border` for component edges, then correct the doc comment.         |
| UI-30 | P2  | Touch         | Touch targets are 32 px: tree rows (`min-h-8`), folder toggles, header icon links (`size-8`), and `Button size="sm"` (`h-8`). The phone header packs five of them in one row.                                                                                                                                                                                                              | `apps/web/src/features/shell.tsx:235`, `:260`, `:696`, `packages/ui/src/controls.tsx:53`                                                                                                 | Raise interactive rows and header controls to 44 px on touch widths.                                                                                                    |
| UI-31 | P2  | Responsive    | The phone header keeps text labels ("Menu", "New note", "Notesapp") next to four other controls at 390 px, so it is close to overflow and the layout depends on a flexible spacer collapsing to zero.                                                                                                                                                                                      | `apps/web/src/features/shell.tsx:625` to `:704`                                                                                                                                          | Hide the button text below `sm`, keep icons with accessible names.                                                                                                      |
| UI-32 | P2  | Layout        | On `/` and `/workspaces/new` the shell still reserves a 256 px sidebar that contains only the workspace switcher, so the screen shows a wide empty rail.                                                                                                                                                                                                                                   | `apps/web/src/features/shell.tsx:449`, `:743`                                                                                                                                            | Hide the rail when there is no workspace context, or make these screens full width routes.                                                                              |
| UI-33 | P2  | Theme         | The header toggle writes an explicit `light` or `dark`, so it silently discards the "System" choice made in settings, and the two controls disagree.                                                                                                                                                                                                                                       | `apps/web/src/features/shell.tsx:612`, `apps/web/src/features/accounts.tsx:209`                                                                                                          | Make the header control a three state cycle, or show the current choice and open the setting.                                                                           |
| UI-34 | P2  | Copy          | Theme options are named "Tokyo Night Day" and "Tokyo Night Night". The user chooses a palette, not a product name, and "Night Night" reads as a mistake.                                                                                                                                                                                                                                   | `apps/web/src/features/accounts.tsx:213`                                                                                                                                                 | "System", "Light", "Dark", with the palette name in the help text.                                                                                                      |
| UI-35 | P2  | Note screen   | Folders exist only by typing a slash into a field labelled "Note name". Nothing tells the user that "Projects/Ideas" creates a folder, and there is no move, no new folder, and no rename of a folder.                                                                                                                                                                                     | `apps/web/src/features/note-editor.tsx:670`, `apps/web/src/features/shell.tsx:155`                                                                                                       | Either commit to folders with a visible path control and a move action, or drop folders for v0.1 and keep one flat list with search.                                    |
| UI-36 | P2  | Note screen   | The note screen has no title heading (the only `h1` is `sr-only`), no created or updated time, no word count, and no back link to the note list. The only header action is "History and checkpoints".                                                                                                                                                                                      | `apps/web/src/features/shell.tsx:1039`, `apps/web/src/features/note-editor.tsx:992`                                                                                                      | Give the note screen a real header: name, quiet metadata, save state, and an overflow menu with History, Export, and Delete.                                            |
| UI-37 | P2  | Browser       | The document title is always "Notesapp". No screen sets `document.title`, so tabs, history, and installed windows cannot be told apart.                                                                                                                                                                                                                                                    | `apps/web/index.html:200`, no `document.title` anywhere                                                                                                                                  | Set the title per route: note name, then the application name.                                                                                                          |
| UI-38 | P2  | Outline       | The outline reads the accepted server text with `getFile`, not the open buffer, so it is stale while the user types and empty offline. Outline rows are plain text, not links, so they cannot move the cursor.                                                                                                                                                                             | `apps/web/src/features/backlinks.tsx:254`                                                                                                                                                | Build the outline from the editor buffer and make each row jump to its heading.                                                                                         |
| UI-39 | P2  | Empty states  | A new note opens as a blank editor with no placeholder and no hint, because no CodeMirror placeholder extension is configured. The name field is prefilled with "New note".                                                                                                                                                                                                                | `apps/web/src/features/new-note.tsx:60`, `packages/editor/src/create-editor.ts:127`                                                                                                      | Add a placeholder line, for example "Start writing. Markdown works here."                                                                                               |
| UI-40 | P2  | Shortcuts     | The shortcuts dialog lists three shortcuts, omits Alt plus Enter (open link at cursor), and claims Cmd plus S is global. Cmd plus S is registered only inside CodeMirror, so it does nothing while focus is in the name field.                                                                                                                                                             | `apps/web/src/features/shell.tsx:773`, `packages/editor/src/create-editor.ts:129`                                                                                                        | Register Save at the window level, and generate the dialog from one shortcut table.                                                                                     |
| UI-41 | P2  | Shortcuts     | Quick open is bound to Cmd or Ctrl plus O, which no comparable editor uses, and it is discoverable only through a 12 px text button at the bottom of the sidebar, which is hidden inside the drawer on phones.                                                                                                                                                                             | `apps/web/src/features/shell.tsx:555`, `:727`                                                                                                                                            | Bind Cmd or Ctrl plus K, show the hint in the header search affordance, and keep O as an alias.                                                                         |
| UI-42 | P2  | Login         | Setup and sign in share one form. Password rules appear only after a failure ("Use at least 12 password characters."), there is no confirm field, and no show password control. If `getSetupStatus` fails, `initialized` stays null and the submit button stays disabled with a machine error, with no retry.                                                                              | `apps/web/src/features/accounts.tsx:65`, `:110`, `:173`                                                                                                                                  | State the password rule under the field, add a retry for the status call, and label the two modes clearly.                                                              |
| UI-43 | P2  | Sign out      | Sign out lives in two places with different rules: the settings card (`session.signOut`, with a pending work checkbox) and the recovery screen (`lifecycle.signOut`, with a discard checkbox and an offline path). The two paths behave differently.                                                                                                                                       | `apps/web/src/features/accounts.tsx:540`, `apps/web/src/features/recovery.tsx:113`                                                                                                       | One sign out flow. Keep the offline marker logic behind it.                                                                                                             |
| UI-44 | P2  | Duplication   | Three "New note" buttons are visible at once on a desktop workspace screen: header, sidebar, and page body, and all three are `variant="primary"`.                                                                                                                                                                                                                                         | `apps/web/src/features/shell.tsx:439`, `:668`, `:940`                                                                                                                                    | One primary action per screen. Keep the sidebar button and make the others secondary or drop them.                                                                      |
| UI-45 | P2  | Duplication   | The page frame `mx-auto max-w-4xl space-y-4 p-4 sm:p-6` and the heading `mb-4 mt-0 text-xl font-semibold text-strong` are repeated across 34 and 27 sites. There is no `Page`, `PageHeader`, `Card`, or `EmptyState` component.                                                                                                                                                            | `apps/web/src/features/*.tsx`                                                                                                                                                            | Add layout primitives to `packages/ui` and use them everywhere.                                                                                                         |
| UI-46 | P2  | Design tokens | Non token colours in feature code: `bg-black/50` and `bg-black/55` for scrims, and `text-white` in the danger button. Two different scrim opacities for the same purpose.                                                                                                                                                                                                                  | `apps/web/src/features/shell.tsx:707`, `:755`, `apps/web/src/features/search.tsx:251`, `packages/ui/src/controls.tsx:46`                                                                 | Add a `scrim` token and an `onDanger` token to the theme.                                                                                                               |
| UI-47 | P2  | Design tokens | `themePropertyNames` writes `--notes-accent`, `--notes-success`, and `--notes-danger`, which the Tailwind theme never maps and nothing in the web application consumes.                                                                                                                                                                                                                    | `packages/ui/src/theme.ts:194`, `apps/web/src/tailwind.css:24`                                                                                                                           | Delete the unused tokens, or map them and use them for large text and graphics as the doc claims.                                                                       |
| UI-48 | P2  | Design tokens | The palette is duplicated in four places: `theme.ts`, the inline script in `index.html`, the `theme_color` in the manifest, and the diagram frame stylesheet. A palette change needs four edits and can drift.                                                                                                                                                                             | `packages/ui/src/theme.ts:84`, `apps/web/index.html:196` and `:212`, `apps/web/public/manifest.webmanifest`, `apps/web/src/diagram/frame.html:15`                                        | Generate the inline script values and the frame values from the token module at build time.                                                                             |
| UI-49 | P2  | Design tokens | `tailwind.css` maps every colour to a runtime variable with no fallback, so any failure of `applyTheme` leaves the whole application without colour.                                                                                                                                                                                                                                       | `apps/web/src/tailwind.css:16`                                                                                                                                                           | Give each `@theme` colour a static fallback, for example `var(--notes-bg, #1a1b26)`.                                                                                    |
| UI-50 | P2  | Type scale    | Four small sizes are in use: `text-xs` (12 px, 8 sites), `text-control` (13 px), `text-ui` (14 px), and `text-base` (16 px) for `h2`, while `h3` uses `text-ui`, so `h3` and body text are the same size. The note title input is `text-lg` while page titles are `text-xl`.                                                                                                               | `apps/web/src/tailwind.css:9`, `apps/web/src/features/shell.tsx:460`, `:768`, `apps/web/src/features/note-editor.tsx:673`                                                                | Delete `text-xs` in favour of `text-control`, and set one heading ramp where the note title is the largest item on the note screen.                                     |
| UI-51 | P3  | Icons         | Six icon sizes are hand written (13, 14, 15, 16, 18, 36) against a fixed `strokeWidth="2"`, so the stroke weight looks different per site.                                                                                                                                                                                                                                                 | `apps/web/src/features/shell.tsx:245`, `:270`, `:279`, `:955`, `packages/ui/src/icons.tsx:17`                                                                                            | Allow two or three named sizes and scale the stroke with the size.                                                                                                      |
| UI-52 | P3  | Layout        | `h-13` and `top-13` encode the header height twice as a magic value that must stay in sync.                                                                                                                                                                                                                                                                                                | `apps/web/src/features/shell.tsx:625`, `:715`                                                                                                                                            | One CSS variable or one theme spacing entry for the header height.                                                                                                      |
| UI-53 | P3  | Dead code     | `useLocalSnapshotStatus` is exported and never used. Six icons are exported and never used (`AlertCircleIcon`, `CloseIcon`, `CloudCheckIcon`, `CloudUploadIcon`, `ComputerIcon`, `ShareIcon`). `CollapsibleSection` has a `count` prop no caller passes. `Badge` has a `warning` variant that renders exactly like `accent`.                                                               | `apps/web/src/app.tsx:430`, `packages/ui/src/index.ts:43`, `packages/ui/src/controls.tsx:229`, `:106`                                                                                    | Delete unused exports, or use the cloud icons for the sync state that UI-01 adds.                                                                                       |
| UI-54 | P3  | Render purity | `loaderRef.current = createAttachmentLoader(workspaceId)` runs on every render, so a new loader is built for every keystroke, and a ref is written during render.                                                                                                                                                                                                                          | `apps/web/src/features/note-editor.tsx:206`                                                                                                                                              | Build it in a memo keyed by `workspaceId`.                                                                                                                              |
| UI-55 | P3  | Copy          | The 404 page and several error screens say "Back to workspaces", but `/` immediately redirects into one workspace, so the destination does not exist as a screen.                                                                                                                                                                                                                          | `apps/web/src/router.tsx:99`, `apps/web/src/features/shell.tsx:843`, `apps/web/src/features/history.tsx:200`                                                                             | "Back to your notes".                                                                                                                                                   |
| UI-56 | P3  | Copy          | The failure chip prints a literal log prefix: "[error] Save failed".                                                                                                                                                                                                                                                                                                                       | `apps/web/src/features/save-status.tsx:72`                                                                                                                                               | Drop the prefix and use the danger token plus an icon.                                                                                                                  |
| UI-57 | P3  | Copy          | Plural handling uses the "change(s)" and "revision(s)" pattern in at least eight places.                                                                                                                                                                                                                                                                                                   | `apps/web/src/app.tsx:361`, `apps/web/src/features/accounts.tsx:523`, `apps/web/src/features/offline-status.tsx:131`                                                                     | One small plural helper, or copy that avoids the count.                                                                                                                 |
| UI-58 | P3  | Grid          | Each note card shows the basename as the title and the full display path as the subtitle, so a root level note shows the same string twice. Cards are ordered by path, never by recency, although they show a date.                                                                                                                                                                        | `apps/web/src/features/shell.tsx:986`                                                                                                                                                    | Show the folder only when there is one, and order by last change.                                                                                                       |
| UI-59 | P3  | Editor find   | `@codemirror/search` is not installed, so there is no find or replace inside a note, and the browser find covers only the rendered viewport.                                                                                                                                                                                                                                               | `packages/editor/package.json:18`                                                                                                                                                        | Owned by the editor audit, but it blocks a "best Markdown editor" claim.                                                                                                |
| UI-60 | P3  | Tooling       | The repository has lint tools for versions, boundaries, and optional properties, but none for the design rules in AGENTS.md, which is why `text-white`, `bg-black/50`, and four unstyled screens survived.                                                                                                                                                                                 | `tools/`, `AGENTS.md` Product design                                                                                                                                                     | Add a check that fails on non token colours and on raw `<ol>`, `<pre>`, and `<progress>` in feature code.                                                               |

## Screen and route inventory

| Route                          | Screen                                                             | Verdict for v0.1              | Reason                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                       | Setup and sign in, one form                                        | Keep                          | The single entry point. Needs the copy and error work in UI-42.                                                                                      |
| `/`                            | `WorkspaceHome`, redirect only                                     | Merge                         | Should be the notes home, not a redirect through an empty shell.                                                                                     |
| `/w/:id`                       | Workspace notes grid                                               | Keep as "All notes"           | The only real list screen. Needs recency order and one primary action.                                                                               |
| `/w/:id/notes/:fileId`         | Note editor                                                        | Keep                          | The product. Needs a real header, save state, and an overflow menu.                                                                                  |
| `/w/:id/notes/:fileId/history` | History, diff, restore, named checkpoints                          | Keep, rebuild                 | Versioned history is a headline feature, but the screen is a prototype (UI-22, UI-23). Cut named checkpoints and the local checkpoint list for v0.1. |
| `/settings`                    | Account, theme, agent tokens, sign out                             | Keep, split                   | Profile, theme, and sign out belong here. Agent tokens belong under an "Integrations" section or behind a flag.                                      |
| `/workspaces/new`              | Create workspace                                                   | Cut                           | A single user does not need a second workspace at launch.                                                                                            |
| `/w/:id/settings`              | Workspace role badges, rename, delete, links to purge and recovery | Cut or merge                  | Role and personal badges are meaningless for one owner. Rename becomes irrelevant if workspaces go.                                                  |
| `/w/:id/purge`                 | Owner only purge with previews, blockers, and recovery copies      | Cut from the interface        | This is an operator tool. Replace with a trash that has Restore and Delete permanently. Keep the API and the CLI.                                    |
| `/w/:id/recovery`              | Access states, kept work, offline sign out, clipboard copy         | Cut or fold in                | The visible parts belong to sign out and to the save failure path. The viewer and revoked access states cannot happen for one owner.                 |
| `/w/:id/offline`               | Download progress, pin images, pin history                         | Cut or fold in                | Two bare progress bars and two pin buttons. Fold "available offline" into one line in settings.                                                      |
| Workspace switcher menu        | Sidebar dropdown with create                                       | Cut                           | See UI-18 and the workspaces question below.                                                                                                         |
| Quick open dialog              | Cmd or Ctrl plus O, path match                                     | Keep, promote                 | This is the right primitive. Make it the one command palette (UI-11) with a visible entry point.                                                     |
| Header search dropdown         | Content search, insert stable link                                 | Merge into the palette        | Two search UIs, one hidden below 640 px (UI-10, UI-11).                                                                                              |
| Shortcuts dialog               | Static list of three                                               | Keep, fix                     | Wrong content and no focus management (UI-16, UI-40).                                                                                                |
| Outline and backlinks panels   | Collapsible sidebar sections                                       | Keep outline, defer backlinks | The outline is core to a Markdown viewer once it reads the buffer. Backlinks need wiki links, which are unfinished (UI-04).                          |
| 404                            | Not found                                                          | Keep                          | Fix the copy (UI-55).                                                                                                                                |

Missing for v0.1, in priority order:

1. Save state and sync state, visible at every width (UI-01, UI-05).
2. Trash with Restore and an undo notice after delete (UI-03).
3. One command palette with a pointer entry point (UI-10, UI-11).
4. Recently changed order and a "Recent" section in the sidebar (UI-58).
5. Rename that is understood as rename, and move between folders (UI-35).
6. Export one note and export all notes as Markdown files. Nothing in the
   application can produce a file. There is no download, no copy as Markdown,
   and no print path.
7. Update available notice for the installed application (UI-24).
8. Duplicate a note, and a first run empty state that offers a starter note.
9. Per note metadata: last saved time, word count (UI-36).
10. Pinning or favourites, and tags. These can wait, but the sidebar has room.

Is the workspaces concept justified? No. The server creates exactly one
workspace named "Personal" for the single account (`apps/server/src/auth/setup.ts:65`)
and refuses a second account. The contract has no members, invite, or share
operations, so `role` is always `owner` and `personal` is always true. The
interface still carries a switcher, a create screen, a settings screen with a
role badge, `canWrite` checks in five files, a "Read only" badge, viewer and
access lost sync notices, per workspace agent token scopes, and owner only
gates on the purge screen. For v0.1 the workspace should become an implicit
container: keep `workspaceId` in the API and in the URL if that is cheaper,
remove the concept from the interface, and let folders carry the grouping.

## Flow by flow notes

### First run setup

`getSetupStatus` decides whether the same form creates the owner or signs in
(`accounts.tsx:65`). The heading changes to "Create your account", autocomplete
switches to `new-password`, and the button label changes.

Defects and friction:

- No password rule until the request fails, and then the message is a guess:
  "The account could not be created. Use at least 12 password characters."
  covers every 400 and 401 (`accounts.tsx:102`).
- No confirm password field and no show password control, so a typo in the only
  account password is easy and expensive.
- If `getSetupStatus` fails, `initialized` stays null, the button stays
  disabled, and the only feedback is a machine error string. There is no retry.
- The setup screen does not say that this is a single user installation, and it
  does not say how password recovery works (`pnpm account:recover`).
- After success the user lands on a workspace named "Personal" whose `h1` is
  "Personal", which explains nothing (`shell.tsx:926`).

### Login

Works. `RequireSession` shows "Checking the session." then redirects
(`accounts.tsx:42`). The offline case is handled in `app.tsx:180`: a cached
account keeps the session alive, but the message it produces is never shown
(UI-09), so an offline start looks identical to an online start until an action
fails.

### Creating a note

`NewNoteButton` writes a local draft named "New note", or "New note 2" when
the name is taken, then navigates with `focusNoteName` route state so the name
field is focused and selected (`new-note.tsx:60`, `note-editor.tsx:209`). This
is a good flow. Problems:

- Three simultaneous primary buttons (UI-44).
- The new file appears in the tree at once, which is correct, but the tree
  reopens every folder at the same time (UI-17).
- The editor is empty with no placeholder (UI-39).
- The name is a path in disguise (UI-35).

### Naming and renaming

The name field is the path field. Every keystroke rewrites `pathRef`, validates
with `normalizePath`, and schedules a draft write after 120 ms
(`note-editor.tsx:683`). Renaming is therefore invisible: there is no rename
action, no confirmation, and no history entry the user can see. Validation
errors are readable but generic: "Use a note name without empty folders,
traversal, or edge spaces." (`workspaces.tsx:163`). Any other refusal prints a
raw code: "This note name is refused: invalid_path." There is no duplicate name
check, so two notes can carry the same name until the server answers a save.

### Saving

The model is right and the implementation is careful: typing writes an
IndexedDB draft, Save creates an immutable local checkpoint and queues it, and
`resolveSaveState` derives six states from durable facts
(`save-state.ts:21`). The interface then throws all of it away:
`SaveStatus` returns `null` unless the state is `storage-full` or
`save-failed` (`save-status.tsx:62`). The e2e suite asserts that no save text
is visible (`tests/e2e/notes.spec.ts:29`), so this is deliberate, and it is
the single biggest UX defect in the application. The user cannot tell an
unsaved note from a saved one, cannot tell a local save from a server save,
and gets no confirmation that Save worked. `Save` also silently does nothing
when the path is invalid (`note-editor.tsx:304`), while the only clue is the
error under the name field.

### Understanding offline state

There is no offline indicator. `useWorkspaceSync` produces engineering prose,
the shell keeps it only when it matches a substring list, and it renders inside
the drawer footer, invisible on phones (UI-05, UI-06, UI-07). The dedicated
offline screen is two bare progress bars behind two clicks in workspace
settings, and it reports app assets by probing `caches.match('/index.html')`
(`offline-status.tsx:249`), which is a build detail leaking into a user screen.

### Viewing history and restoring

Reaching history takes one link at the top of the note ("History and
checkpoints"). The screen loads the head, the first page of server revisions,
and the local checkpoints, and it computes an inline diff against the head in a
worker. The logic is sound, including a generation guard against races
(`history.tsx:384`). The presentation is not shipped: raw UUIDs, raw ISO
timestamps, bullet lists of buttons, a raw `<pre>` for the old text, and an
inline "Back to the note. | Deletion and purge." line with a literal pipe
(`history.tsx:563`). Restore explains itself well
(`history.tsx:500`). Named checkpoints depend on an ETag and, when the ETag is
missing, the screen tells the user about entity tags
(`history.tsx:659`), which no reader can act on.

### Searching

Two search paths, described in UI-10 and UI-11. The header dropdown merges
local and remote hits, debounces at 150 ms, closes on Escape and outside
pointer, and shows "Offline results from this device." when `navigator.onLine`
is false. It is hidden below 640 px. Results carry an "Insert link" button that
dispatches a `window` custom event which the editor listens for
(`search.tsx:27`, `note-editor.tsx:342`). That is a hidden global event bus
between two features, and the action is a no operation with a notice unless
text is selected in an open note. Quick open is keyboard only, matches paths
only, has `role="listbox"` without `aria-activedescendant` on the input, and
does not restore focus on close.

### Deleting and recovering

Delete is inline two click confirm, then it queues a deletion checkpoint and
navigates to the workspace (`note-editor.tsx:641`). There is no undo, no
trash, and no deleted list. The only recovery route is the purge screen, where
the user must paste the file UUID into "Add a file ID that is no longer
listed". A deleted note is therefore unrecoverable in practice (UI-03). The
purge screen itself is an operator tool: checkbox list of every file with its
UUID, deletion markers, blocking references, reclaimed bytes, and post purge
recovery copies.

### Switching theme

Three ways, two behaviours. The header toggle flips light and dark and discards
the "System" choice (UI-33). The settings select offers all three with product
names (UI-34). The choice is written to `localStorage` first, applied to the
document, and synced to the account in the background; a failed sync sets a
message that is never rendered (UI-09). The inline script in `index.html`
prevents a flash, at the cost of a fourth copy of the palette (UI-48).

### Keyboard

Global: Cmd or Ctrl plus O opens Quick open, Escape closes Quick open and the
shortcuts dialog (`shell.tsx:553`). Drawer: Escape closes it, Tab cycles
inside it, and focus returns to the menu button, which is the one correct
focus trap in the codebase (`shell.tsx:567`). Editor: Cmd plus S saves, Cmd
plus Enter toggles a task, Alt plus Enter opens a link
(`packages/editor/src/create-editor.ts:127`). There are no formatting
shortcuts, no find in note, no shortcut to focus search, and no shortcut for
new note. The shortcuts dialog documents three of the five that exist and one
of them incorrectly (UI-40).

## Design system assessment

What is solid:

- One CSS entry point, no CSS modules, no inline styles, and no handwritten
  selectors anywhere in `apps/web/src` or `packages/ui`. The migration rule was
  followed.
- Semantic colour names (`app`, `surface`, `card`, `hover`, `active`, `ink`,
  `strong`, `muted`, `accent`, `edge`, `focus`) are used consistently in the
  screens that were migrated, and feature code almost never reaches for a raw
  colour.
- Two named text sizes (`text-control` 13 px, `text-ui` 14 px) exist and are
  used.
- Icons are one family, 24 by 24, `strokeWidth="2"`, `aria-hidden`, colour
  inherited. That is a real system.
- `theme.ts` ships contrast helpers and a test, and the derived `*Text` tokens
  show that contrast was thought about.

What is not a system yet:

- Coverage is partial. Four screens never got the pass (UI-22), so the product
  looks like two products.
- No layout primitives. The page frame and the page heading are copy pasted
  34 and 27 times (UI-45). There is no `Page`, `Card`, `EmptyState`, `Dialog`,
  `List`, or `Toolbar`, so every screen invents its own spacing.
- The control set is thin: `Button`, `Badge`, `TextField`, `SelectField`,
  `CollapsibleSection`, `StatusRegion`. Checkboxes, radios, menus, dialogs,
  tooltips, and toasts are hand rolled inline where needed, with a bare
  `<input type="checkbox">` in five places.
- Token gaps force local workarounds: no scrim token, no danger fill pair, no
  warning colour, three unused tokens (UI-46, UI-47, UI-53).
- The type ramp has four small sizes and an `h3` that matches body text, and
  the note title is smaller than a page title (UI-50).
- Elevation is ad hoc: `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`
  appear with no rule, and radii mix `rounded-md`, `rounded-lg`, and
  `rounded-xl` for similar objects.

Point of view: currently generic. It is a competent Tokyo Night dashboard:
grey cards, small blue accents, a 256 px rail, a 52 px header, and a three
column card grid that any admin template would produce. Nothing in the layout
says "Markdown editor". The typeface is the system stack in both the interface
and, presumably, the note body, so the reading surface has no character. For a
product whose one promise is writing and reading Markdown, the note surface
should be the design: a comfortable measure, a chosen reading typeface, real
vertical rhythm, quiet chrome that recedes while typing, and one accent that
means "saved". The card grid and the file tree should be the quiet parts.

Light and dark handling: the runtime palette approach works and avoids a flash,
but it is fragile. Every colour resolves through a JavaScript written custom
property with no fallback (UI-49); the palette lives in four places (UI-48);
`data-theme` is set in three places (the static attribute in `index.html:188`,
the inline script, and `applyTheme`); and the light palette is the weaker of
the two, with body text failing AA on the sidebar surface (UI-15) and the
dark palette failing on destructive buttons (UI-14). The claim in the
`theme.ts` header that every text combination meets AA and every border meets
3 to 1 is not true as written; nine light theme text pairs and every
`borderSubtle` pair fail. `packages/ui/src/theme.test.ts` should assert the
pairs the application actually renders, per surface, so the doc and the code
agree.

`THIRD_PARTY_LICENSES.md` is correct and specific: it names the upstream
project, the Apache 2.0 licence, the two source files, and which values were
copied and which were derived. No action needed.

## Recommended v0.1 information architecture

Shell, one frame for every signed in screen:

- Header, 48 px, three zones. Left: drawer toggle below `md`, then the product
  mark. Centre: one search affordance that opens the command palette and shows
  the shortcut hint. Right: save and sync state, then a single overflow menu
  with Theme, Settings, and Sign out. No workspace switcher. Two controls at
  most on a phone besides the drawer toggle.
- Sidebar, 240 to 280 px, resizable later. Top: one primary "New note" button,
  the only primary action in the shell. Then "Recent", five to seven notes by
  last change. Then "All notes" as the folder tree, filtered to notes. Bottom:
  a quiet footer with the connection state and one link to Settings. Drop the
  outline and backlinks from the sidebar; the outline belongs next to the note.
- Content: one `<main>` per route, one page frame primitive, a maximum measure
  tuned for reading.

Note view, the centre of the product:

- Header row: the name as an inline editable title in the largest type on the
  screen, then the save state chip, then an overflow menu with History,
  Export, Duplicate, Move, and Delete. Nothing else.
- Body: the editor at a reading measure with a placeholder when empty.
- Right rail on wide screens, collapsible: outline built from the live buffer,
  with rows that move the cursor. Backlinks join it when wiki links work.
- Footer, quiet: last saved time and word count.

Command palette, Cmd or Ctrl plus K, one dialog with a focus trap:

- Empty state: recent notes.
- Typing: note names first, then note content, in one ranked list.
- Actions in the same list: New note, Toggle theme, Show shortcuts, Open
  history of this note, Insert link to a note when an editor selection exists.
- Escape closes and returns focus. This replaces both current search UIs.

Screens beyond the shell: `/login`, `/settings` (profile, theme, offline,
integrations, sign out), the note list, the note, the note history, and the
trash. Everything else in the current route table becomes an API and CLI
capability, not a screen.

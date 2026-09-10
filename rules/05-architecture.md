# Application architecture

- Keep package boundaries strict. Domain code must not import transport,
  database, browser, or React code.
- Use generated API client operations. Do not write request URLs or direct
  `fetch` calls in feature code.
- Treat browser drafts as recovery data, not server versions. Only an explicit
  Save action creates an immutable server version.
- Keep one CodeMirror editor instance for an open working copy. Do not replace
  its document during a React render, theme change, or preview update.
- Store note paths with one `.md` suffix. Hide this storage detail from the
  person who edits the note name.
- Keep rich Markdown rendering isolated from network and storage access. Pass
  attachments and diagram rendering through typed resolvers.
- Validate at domain boundaries. Do not weaken a server invariant to hide a
  client defect.

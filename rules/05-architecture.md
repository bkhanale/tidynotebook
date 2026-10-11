# Application architecture

- Keep package boundaries strict. Domain code must not import transport,
  database, browser, or React code.
- Use generated API client operations. Do not write request URLs or direct
  `fetch` calls in feature code.
- Treat browser drafts as recovery data, not server versions. Only a
  checkpoint creates an immutable server version: a pause in typing, leaving
  the note, or Ctrl + S (decision record 0022).
- Keep one CodeMirror editor instance for an open working copy. Do not replace
  its document during a React render, theme change, or preview update.
- Store note paths with one `.md` suffix. Hide this storage detail from the
  person who edits the note name.
- Keep rich Markdown rendering isolated from network and storage access. Pass
  attachments and diagram rendering through typed resolvers.
- Validate at domain boundaries. Do not weaken a server invariant to hide a
  client defect.
- Put new code where decision record 0018 says. It states the directory
  structure of the server, `core`, the stores, and the web application.
- Do not write a type assertion. Only `as const` is allowed. Reach a type
  through a type guard or a parser that fails loudly (decision record 0019).
- Before a change to the interface that a service of the operator depends on,
  read `docs/development/operator-api.md`. It names that interface and the
  changes that break it. When a checkout of the cloud repository sits beside
  this one at `../cloud`, read its `AGENTS.md` too, and state the effect on
  the cloud in the commit body. `tools/agent-context.mjs` lists both files.

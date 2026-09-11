# Documents

- Before you write a document, read `docs/README.md`. It states the audience,
  the purpose, and the required header of each documentation directory.
- A document points at code by path and never copies it. Do not copy source, a
  configuration value, a schema, a column list, SQL, TypeScript, YAML, a
  version number, or a measured result.
- The one allowed code block is a shell command that the reader runs. Any other
  fenced language fails `pnpm lint` outside `docs/history/`.
- Every `.md` file under `docs/` sits in `guide`, `development`, `decisions`,
  `releases`, `audits`, `plans`, or `history`.
- `docs/guide/` is public and flat. Each page starts with the title line and
  one sentence that states who the page is for.
- `docs/development/` holds the intent, the invariants, and the pointers of one
  area. Keep a page under 150 lines. Link a decision record rather than
  restating the decision.
- A new architectural choice gets a record in `docs/decisions/` from the
  template, before the code.
- `docs/releases/<version>.md` is the one prioritized list for that release and
  carries a `Status:` line. Do not start a second list.
- An audit in `docs/audits/<date>/` names its date and its commit and is never
  edited after it lands.
- A document that no longer describes the product moves to `docs/history/` with
  `git mv` and a two line superseded note at its top.

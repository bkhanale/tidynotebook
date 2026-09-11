# Feature workflow

- Before you edit under a directory, read its `AGENTS.md`. Every app, every
  package, and the `tests` tree has one.
- Follow `docs/development/feature-workflow.md` for a whole feature. The
  order is the contract, the domain rule, the storage, the handler, the
  client, then the verification.
- Write the operation in `packages/api-contract/openapi.yaml` before any code
  that uses it, then run `pnpm generate`. Never edit a file under a
  `src/generated/` directory.
- A new architectural choice gets a decision record in `docs/decisions`
  before the code. A choice is architectural when it moves a boundary, adds
  or removes a package, changes the save model, adds a second parser or
  renderer, changes the contract emit rules, changes the migration policy, or
  changes what the verification gate proves.
- Keep `AGENTS.md` true. A change that moves a boundary, a key file, or a
  rule updates the `AGENTS.md` of that directory in the same commit.

# Verification

This page explains what the local checks cover.
The development process is in [AGENTS.md](../../AGENTS.md).

`pnpm verify` runs the checks in `package.json`: contract validation,
generated output comparison, types, lint, format, build, typed lint, unit tests,
and integration tests. The build comes before typed lint because it supplies
package declarations.

`tools/run-tests.mjs` discovers unit tests beside the source and tool files.
It discovers integration tests under `tests/integration/`.
The tests use PostgreSQL and MinIO from `compose.test.yaml`.
Each integration test creates its own database or bucket.

Node cannot strip JSX. Logic that needs a unit test can live in a plain
TypeScript module beside the component. Integration tests can check built
styles and served results. Browser checks cover actual interaction and layout.

CI runs scoped checks on each push. `Check` requires every selected job to pass.
Source changes run static checks, the bundle budget, three unit shards and four
integration shards. Document changes run format and document checks. Image
inputs also run image smoke tests. Workflow changes run actionlint and zizmor. Local Docker testing uses the production image and entry
point. There is no local proof receipt or test-file gate.
A manual workflow can move `main` to a reviewed head without a new test run.
See [Fast forward merge](fast-forward-merge.md).

The service performance budget and coverage report run nightly. The bundle
budget runs with source checks. Browser measurements use a local Playwright install in
`.local-app/` when needed.

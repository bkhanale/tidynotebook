# Plan 007: Central logging

Status: complete

> The live item is [GitHub issue 21](https://github.com/bkhanale/notesapp/issues/21) on the project board.

This plan turns [design 003](../design/003-central-logging.md) and
[decision 0020](../decisions/0020-central-logging-through-one-module.md) into
ordered work.

## Decisions

- [0020. Central logging through one module](../decisions/0020-central-logging-through-one-module.md)
- Kept: [0018. Directory structure by layer](../decisions/0018-directory-structure-by-layer.md)
- Kept: [0019. Contract validation and shared types](../decisions/0019-contract-validation-and-shared-types.md)

## Items

1. Add the browser-safe event catalog and logger in `packages/logging`.
2. Add the Pino and browser sinks at the application boundary.
3. Move each application log call to a catalog event. Keep worker output as a
   result protocol.
4. Add the console and Pino boundary checks.
5. Add catalog, redaction, sink, and negative lint tests.

## Verification

Run focused package and server tests. Run `pnpm verify`.

# 0170. An archive job is bounded in number, in disk and in time

- Status: Accepted
- Date: 2026-10-02

## Context

An import and an export of a workspace take every archive up to the bounds of
the zip format without ZIP64, from `packages/core/src/files/archive.ts`
([issue 243](https://github.com/bkhanale/notesapp/issues/243)). Nothing bounded
how many ran at once, or the disk that they used. The export wrote the whole
archive before its first byte, so a proxy that waits a fixed time for that
byte gave up with a 504 answer. An import that stopped after some batches left
them committed. Record 0121 puts every limit of the server in PostgreSQL.

## Decision

- An import and an export each hold one reservation of `archive_jobs` while
  they run, across every process: `archiveJobsPerAccount` for one account and
  `archiveJobsPerInstallation` for the installation, in
  `apps/server/src/routes/archive-jobs.ts`. A refused job answers 429
  `archive_job_running` or 503 `archive_jobs_busy`, with `Retry-After`. Both
  operations also count in the attempt group `archive`.
- An export plans its archive from the live heads before its first byte: the
  path and the size of each file. A workspace past a bound answers 422
  `export_too_large` at once. Otherwise the answer states its exact length and
  streams the planned revisions, which never change, with no file on the disk.
  `HEAD` plans and sends no body.
- An import refuses a body longer than its bound from `Content-Length` before
  it reads it. It then reserves its job with the length of its body, or the
  bound when the body states none, and refuses with 507 `storage_full` a body
  that the free space of the storage volume, less `archiveDiskReserveBytes`
  and less the bodies that the other running jobs stated, cannot hold. The
  reservation reads those bodies under its lock, so of two imports that start
  together the later one counts the earlier one. A body that stops ends the
  import and closes its file.
- An import checks every entry before its first commit: the paths in NFC and
  free, each note under the limits of the grammar, each image, and the room of
  the owner. Only a failure of the service stops it after its first commit,
  and that answer, 503 `import_incomplete`, states how many files came in. An
  import of the same archive again refuses the files that are there, so no
  file comes in twice.
- The reader of an import keeps the name of each file until it has checked
  them all, so the names of one archive have a bound together,
  `maxArchiveNameBytes` of `packages/core/src/files/archive.ts`, beside the
  bound of each name, `maxNameBytes` of `apps/server/src/routes/unzip.ts`.
  The reader checks both from the stated length before it decodes a name,
  and refuses past them with `archive_invalid`. An export refuses a
  workspace whose paths pass the bound of the names with
  `export_too_large`, so every archive that it writes still imports.

This excludes a job queue. A refused job asks the person to try again, which
needs no state beyond the reservation.

## Consequences

- One account runs one archive job, and an installation a few, and each job
  keeps one entry, one batch of notes and the names of its archive in memory,
  so the disk and the memory of the jobs stay bounded.
- A large export starts its download at once and needs no disk of the server.
- `tests/integration/export.test.ts` proves the plan, the refusals, the room
  beside a running import, the stop of a body and the checks before the first
  commit. `unzip.test.ts` and `archive-bounds.test.ts` prove the bounds of
  the names.

# 0193. Transfer and object operations have a limit

- Status: Accepted
- Date: 2026-10-04

## Context

Each byte that leaves the host and each call to an object store costs the
operator money. Readers of a published page are strangers. A person can also
download the same export or the same snapshot again and again, and the job
bounds of record 0170 bound work at one time, not bytes in a month. The reader
path writes nothing today (record 0031), and a database write for each answer
would make each response cost a write. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- **One count.** At the response boundary the server counts the bytes that it
  sends for an account: the reader path for the owner of the workspace, and
  every authenticated response for the account of the session. The S3 adapter
  of record 0192 counts each call that it makes, as a write (a put, a copy, a
  part, a list) or a read (a get, a head).
- Each process adds the counts to a sum in memory for each account and for the
  installation, and writes the sums to one monthly table every `10 s`. A check
  reads the stored total of the month and adds the sum of its own process.
  Several processes can pass a limit by the traffic of one interval, and that
  is accepted.
- **Published transfer.** Past the limit of an account (record 0189) or past
  `NOTESAPP_PUBLISHED_TRANSFER_CAP_BYTES` for the installation, the reader
  path answers the closed page of record 0146 until the next month in UTC.
- **Downloads.** Past the download limit of an account or past
  `NOTESAPP_DOWNLOAD_CAP_BYTES` for the installation, an export, an attachment
  and a sync snapshot answer `download_limit` until the next month. A small
  answer of the API and a sync change still answer, so the application keeps
  working.
- **Object operations.** Past `NOTESAPP_OBJECT_WRITE_CAP` writes in a month,
  an upload and an import answer `storage_busy`. Past
  `NOTESAPP_OBJECT_READ_CAP` reads, an attachment answers `download_limit`,
  and the reader path shows a page without its images. Both hold until the
  next month.
- The owner sees each state of an account on its settings, and the operator
  API answers the totals of the month.
- With no limit and no cap, nothing is checked.

## Consequences

- An operator can bound the transfer and the object store bill.
- An integration test proves each closure past the limit of an account and
  past each cap, with two server instances that share one total.

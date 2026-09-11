# 0012. The package layout stays for v0.1

- Status: Accepted
- Date: 2026-09-10

## Context

The audits recommended three merges: `sync` with `storage-browser`, the three
API packages into one, and `editor` into `ui`. Each merge moves files while
the same release also deletes a large amount of code.

## Decision

Dead code is deleted from every package in v0.1, but no package is merged.
The merges are v0.2 work, after the code is smaller.

## Consequences

- A review of a v0.1 change reads as a deletion, not as a move.
- The dependency table in `tools/check-boundaries.mjs` does not change in
  v0.1.
- The merges stay open questions and need their own decision records.

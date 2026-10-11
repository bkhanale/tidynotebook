# 0214. Read the completed automatic review

- Status: Accepted
- Date: 2026-10-09

## Context

An automatic Codex review can report completion in its summary and approve the
PR with a reaction. A separate clean comment is not always present.
The owner requires one review for one source head.

## Decision

`tools/lifecycle.mjs` accepts the completed Code Review row of the Codex bot
summary together with its later approval reaction on the PR.
The row must resolve to the exact current commit. The approval must follow the
completion time. The current checks pass and every review thread is resolved.
A reaction alone, a summary alone, a running review, and stale approval refuse.
The existing exact-commit clean review and clean comment paths remain valid.
This refines the review proof of record 0212.

`tools/release.mjs` names a prepare branch from the version and selected source.
A corrected source selection can prepare an unpublished version without
changing an earlier branch. Existing release plans keep their recorded source.
Published tags remain fixed under record 0213.

## Consequences

Automatic review needs no second review or separate Codex task environment.
The reader depends on the observed bot summary format and fails on an unknown
format. `tools/lifecycle.test.mjs` proves current approval, stale approval,
incomplete review, unresolved findings, and an occupied prepare branch.

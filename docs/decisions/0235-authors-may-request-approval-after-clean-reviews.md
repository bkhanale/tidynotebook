# 0235. Authors may request approval after clean reviews

- Status: Accepted
- Date: 2026-10-23

## Context

This repository has one maintainer. CodeRabbit can complete a clean full
review after a rebase without submitting a new approval. The merge gate
requires an approval on the exact head after the rebase.

## Decision

Enable `reviews.allow_author_approval` in `.coderabbit.yaml`.
The author may run `@coderabbitai approve` only after a clean CodeRabbit full
review and a clean independent review on the exact current head. A clean
review has no open findings. A new head requires both reviews again.

The `/ff-merge` gate is otherwise unchanged. The owner controls merges.

## Consequences

The author can request an approval after both reviews pass. This permission
does not replace either review or permit the author to dismiss findings.
The merge gate still checks the approval, statuses, checks, resolved threads,
and branch state before it moves `main`.

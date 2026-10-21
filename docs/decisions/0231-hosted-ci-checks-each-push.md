# 0231. Hosted CI checks each push

- Status: Accepted
- Date: 2026-10-21

## Context

Record [0228](0228-hosted-proof-and-release.md) accepted hosted proof.
Core needs fast checks on free GitHub-hosted runners.

## Decision

Activate the hosted CI part of 0228 with these changes. Check every push on
all branches. Also check fork pull requests, manual runs and the nightly run.
Use a tested path classifier. Unknown paths require source checks. Document
changes run format and document checks. Source changes run static checks,
the bundle budget, three unit shards and four integration shards. Each
integration runner owns its PostgreSQL and MinIO services. Only the first
unit shard runs typed lint. Per-push tests do not measure coverage.

Image infrastructure inputs select an amd64 Compose build and image smoke
tests. Restore its registry cache from GHCR. Only main writes caches.
Changes under the GitHub configuration directory select workflow lint.
Run service performance and coverage nightly. Keep at most nine jobs active
per run. Cancel older branch runs, but keep main runs.

Require only `Check` from GitHub Actions on main. It rejects failed,
cancelled or unexpectedly skipped selected jobs. Keep the fast forward
merge workflows. The owner sets the main ruleset after merge. This change
does not activate release publication or change the local verification rule.

## Consequences

Hosted results show source proof on each head. Image smoke has a narrower
path scope than 0228. Source-only changes do not rebuild the image. Cold
cache runs can take longer. Multi-architecture publication is separate work.

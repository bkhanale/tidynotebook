# 0205. The cloud infrastructure is code

- Status: Accepted
- Date: 2026-10-05

## Context

Record 0199 puts the cloud on Railway behind Cloudflare, and one bullet of it
says that the runbook of the private repository lists each dashboard setting
of Railway and Cloudflare, with no OpenTofu. Design 024 lists infrastructure
as code under what stays out. A dashboard setting has no review, no history
and no check, so a setting that drifts or that a person forgets fails only in
production. The owner now requires the infrastructure of the cloud as code.
See [design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The private repository `tidynotebook/cloud` declares the infrastructure of
  the cloud as OpenTofu code under `infra/`:
  - the Railway project, with its services, environments and variables;
  - the settings of the Cloudflare zone, the DNS records, and the rules of
    record 0200;
  - the R2 buckets and their lifecycle rules (records 0192 and 0199);
  - the static sites of the landing page and the guide (record 0198);
  - Email Routing, and the DNS records of the mail domain;
  - the external check of record 0200.
- The OpenTofu state lives in a private R2 bucket that the code does not
  manage.
- The runbook keeps only a step that no provider API offers, and each such
  step names why no API offers it.
- This record replaces only the bullet of record 0199 that lists the
  dashboard settings, and the line of design 024 that keeps infrastructure as
  code out. Every other part of record 0199 stands.

## Consequences

- A change of the infrastructure is a reviewed commit of the private
  repository, and a plan shows its effect before it applies.
- The state holds the secret values that a provider answers, so only the
  credential of the deploy reads its bucket.
- A provider that does not offer a setting leaves a manual step. The runbook
  names it with its reason, so the list of manual steps only shrinks.
- This repository holds no infrastructure code. Record 0186 still holds.

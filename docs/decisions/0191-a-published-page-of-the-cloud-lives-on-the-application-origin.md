# 0191. A published page of the cloud lives on the application origin

- Status: Accepted
- Date: 2026-10-04

## Context

Record 0118 lets an installation name a published origin, and record 0114
refuses the `open` policy without one. The cloud has one registrable domain
(record 0187), and the owner wants published pages and later collaboration on
the one domain of the product. A page of a published link runs only the script
of the product, under the sanitized renderer of record 0031. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The `open` policy no longer requires a published origin. The rest of record
  0114 stands.
- The cloud names no published origin, so the application origin serves the
  reader path, as record 0118 states for an installation with no published
  origin. A self-hosted operator can still name one.
- Shared workspaces and collaboration live on the application origin.
- The owner accepts that a block list that acts on one hostile published page
  acts on `app.tidynotebook.com`. The report page of record 0119 and the
  takedown stay the defence, and the owner watches the host in Google Search
  Console.

This refines records 0114 and 0118.

## Consequences

- One certificate and one host serve the application and its pages.
- A phishing page that a stranger publishes can get the application blocked
  until the takedown and a review request clear it.
- The integration test of the `open` policy accepts an installation with no
  published origin.

# 0186. One code base serves a paid cloud and a free self-hosted edition

- Status: Accepted
- Date: 2026-10-04

## Context

The owner hosts a paid cloud service and offers the same product for free to
host. A fork or a closed module would make two products that drift and a
boundary that no contributor can test. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- One repository, one image and one release serve both editions.
- `NOTESAPP_BILLING` names the edition: `off`, the default, or `paddle`. With
  `paddle` the server requires the Paddle settings of record 0189 and the
  `open` registration policy, and refuses to start without them.
- The editions differ in who pays, never in what the product does. No feature
  belongs to one plan or one edition. Billing code runs only when the mode is
  `paddle`, and its operations answer 404 `billing_off` otherwise.
- The self-hosted edition sends nothing to the owner: no telemetry, no license
  key, no update check.
- The one row of `installation_settings` stores the billing mode. The server
  writes it at startup, and refuses to start when the stored mode differs from
  the environment and any account exists. The registration function reads the
  stored mode, so a new account of a `paddle` installation starts with no
  plan, and a new account of an `off` installation is always covered.
- `apps/server/src/config.ts` parses the mode, and
  `apps/server/src/installation-settings.ts` stays the one decider that reads
  the row.

## Consequences

- One test suite proves both editions. The integration tests run the billing
  paths with a fake Paddle API and signed fixture events.
- A self-hosted operator never sees a billing screen and never needs a key.
- An integration test proves the startup refusal in both directions, and that
  each mode starts the coverage of a new account as stated.

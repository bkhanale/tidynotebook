# 0186. The open core holds no billing, and a private service sells the cloud

- Status: Accepted
- Date: 2026-10-04

## Context

The owner sells a cloud service and gives the same product away to host. The
owner wants no payment code in the open repository or in its image. Billing
code in the same process as AGPL code that outside contributors wrote must be
offered as source too (record 0188), unless every contributor signs a CLA.
See [design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- This repository is the open core. It holds no payment provider, no plan, no
  price, no catalog, no billing screen and no billing setting.
- One image serves both editions. The cloud runs the public image of a public
  release with no change.
- A private repository, `tidynotebook/cloud`, holds the billing service, the
  landing site and the cloud runbook. The records of the cloud, 0194 to 0200,
  stay in this repository as the history of the choice, and hold no code.
- The billing service is a separate program. It reaches the core only through
  the operator API of record 0190, over HTTP. It shares no process, no module
  and no database role with the core.
- The core offers general account controls (record 0189). The billing service
  sets them. A self-hosted operator can set them by hand or with any tool.
- The self-hosted edition has every feature, including teams and
  collaboration when they exist. Only the cloud turns a feature off for an
  account, through the controls.
- The self-hosted edition sends nothing to the owner: no telemetry, no license
  key, no update check.

## Consequences

- No contributor signs a CLA, and the billing service stays private.
- A self-hosted operator never sees a price, a plan or a billing screen.
- The core gains an operator API and account controls, and each is tested in
  this repository with no billing service.
- The tests of the billing service live in the private repository, against
  a core that runs the public image.

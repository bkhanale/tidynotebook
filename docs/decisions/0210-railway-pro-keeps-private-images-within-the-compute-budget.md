# 0210. Railway Pro keeps private images within the compute budget

- Status: Accepted
- Date: 2026-10-08

## Context

Record 0199 selects Railway Hobby. The owner requires private images to stay
private and approves Pro. Railway requires Pro for
[private registry credentials](https://docs.railway.com/builds/private-registries).
Its [pricing](https://docs.railway.com/pricing/plans) gives Pro a minimum charge
of `$20` each month, with `$20` of resource usage included. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- Pro replaces Hobby from the first deploy. This refines the tier in record
  0199 and the later upgrade from Hobby in record 0200. The core image
  publication policy of records 0186 and 0188 stays. A private image stays
  private, with a registry credential that can only pull it.
- The Pro charge includes the first `$20` of compute usage. Usage below that
  amount costs `$20`. At `$30` of usage, the compute charge is `$30` before
  tax. The included credit is part of the minimum, not an extra charge.
- Keep the compute usage alert at `$20` and the hard limit at `$30` from
  record 0200. These limits cover the whole Railway workspace, including
  production and staging. CPU, memory, storage and egress share the limit.
  Railway's [cost controls](https://docs.railway.com/pricing/cost-control)
  define Compute Usage and stop workloads at its hard limit.
- The other cost controls of record 0200 and the infrastructure boundary of
  record 0205 stay. A larger volume allowance does not raise an account limit.

## Consequences

The owner accepts the Pro minimum and the outage at the hard limit. The first
staging run must prove a private image pull and read back both compute limits.
This record changes no application, contract or infrastructure code here.
The document check holds its links and structure; deployment proves the
provider settings before production.

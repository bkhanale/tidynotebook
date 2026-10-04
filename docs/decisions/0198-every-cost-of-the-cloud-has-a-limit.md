# 0198. Every cost of the cloud has a limit

- Status: Accepted
- Date: 2026-10-04

## Context

Each byte stored, each byte sent, each request and each task costs the owner
money. The plan limits of record 0190 hold storage. Readers of a published
page are strangers, and the reader path writes nothing today (record 0031).
See [design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- **Published transfer.** Each process adds the bytes that the reader path
  sends to a sum in memory for each owner account, and writes the sums to one
  table every `10 s`. A request reads the stored total of the month and adds
  the sum of its process. Past the limit of the plan, the reader path answers
  the closed page of record 0146 until the next month in UTC. The owner of the
  account sees the state on the published links page. Several processes can
  pass the limit by the traffic of one interval, and that is accepted.
- **Requests.** AWS WAF runs the managed common rule set and a rate rule of
  `3000` requests in each five minutes for one address. The webhook of record
  0193 is exempt from the rate rule. The attempt counters of record 0121 stay.
- **Compute.** At most six tasks (record 0197).
- **Database volume.** The RDS volume grows by itself up to `1000 GB` and no
  further.
- **Mail.** At most `20` seat invitations for each subscription in a day, on
  top of the mail budget of each address.
- **Logs.** CloudWatch keeps logs for `30 days`.
- **The bill.** An AWS budget of `$500` a month in production and `$100` in
  staging, with mail alerts at half, at most of it and at all of it, and AWS
  cost anomaly detection.
- **Alarms** by mail to the owner: errors and latency of the load balancer,
  a task that does not start, CPU, storage and connections of the database,
  a failed webhook, a difference that a reconciling job repaired, the bounce
  rate of SES, and a Route 53 health check of `/ready` from outside.

## Consequences

- No account and no stranger can make one line of the bill grow without
  bound, and an alarm reports a cost that grows before the budget is spent.
- An integration test proves that the reader path closes past the transfer of
  the month, with two server instances that share one total.

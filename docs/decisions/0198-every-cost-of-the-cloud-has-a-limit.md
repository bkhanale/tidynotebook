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
- **Published transfer of the whole service.** The same table holds the sum
  of every account. Past `2000 GB` in a month, the reader path answers the
  closed page for every link until the next month, and an alarm mails the
  owner. One busy month can therefore cost at most that much transfer.
- **Requests.** AWS WAF runs the managed common rule set, and these rate
  rules, each over five minutes:
  - `3000` requests from one address, on every host.
  - From all addresses together: `100000` on `tidynotebook.page`, `300000`
    on `app.tidynotebook.com`, and `200000` on each of the CloudFront hosts
    `tidynotebook.com` and `docs.tidynotebook.com`. During a flood the service
    refuses requests instead of growing the bill.
  - The webhook path of record 0193 has its own rule of `1000` requests from
    one address. No request skips a rate rule.
- **No list of Paddle addresses.** Paddle changes the addresses that send its
  webhooks, so a fixed list would refuse valid events in silence. The
  signature check of record 0193 is the gate, its rate rule bounds the cost,
  and the reconcile jobs repair a delivery that failed.
- **Deleted objects.** The lifecycle rule of record 0197 removes a deleted
  attachment from both buckets after its recovery time, so a deletion ends
  its charge.
- The attempt counters of record 0121 stay behind WAF.
- **Compute.** At most six tasks (record 0197).
- **Database volume.** The RDS volume grows by itself up to `1000 GB` and no
  further.
- **Mail.** At most `20` seat invitations for each subscription in a day, on
  top of the mail budget of each address.
- **Logs.** CloudWatch keeps logs for `30 days`.
- **The bill.** An AWS budget of `$500` a month in production and `$100` in
  staging, with mail alerts at half, at most of it and at all of it, and AWS
  cost anomaly detection. A budget is an alarm, not a limit: AWS updates its
  data a few times a day, and it stops no charge. The limits above are the
  bounds.
- **Alarms** by mail to the owner: errors and latency of the load balancer,
  a task that does not start, CPU, storage and connections of the database,
  a failed webhook, a difference that a reconciling job repaired, the bounce
  rate of SES, and a Route 53 health check of `/ready` from outside.

## Consequences

- Each line of the bill that use drives has a bound: storage, database,
  transfer, compute and mail. The one cost that a flood still drives is the
  fee of WAF for each request that it inspects. AWS Shield Standard absorbs a
  flood at the network layer, and the alarms report the rest.
- An integration test proves that the reader path closes past the transfer of
  the month of one account and of the whole service, with two server
  instances that share one total.

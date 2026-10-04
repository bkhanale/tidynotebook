# 0200. Every cost of the cloud has a limit

- Status: Accepted
- Date: 2026-10-04

## Context

Railway charges for the CPU, the memory, the volume and the egress that the
services use. R2 charges for stored bytes past its free part and for each
operation past its free part, on a bill of its own. Resend refuses mail past
its free plan. The free plan of Cloudflare gives one rate rule for the zone,
which matches on the path and counts by address. The owner gives the cloud a
monthly budget of `$20`. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

| What costs money        | The limit that holds it                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The whole Railway bill  | A usage alert at `$20` and a hard usage limit at `$30`. Past the hard limit Railway stops the services.                                                                                                            |
| Compute                 | Two replicas of `app` and one of `billing`. The owner adds a replica by hand.                                                                                                                                      |
| The database volume     | The text and history limit of each plan. The Hobby plan caps a volume at `5 GB`, and the owner moves to Pro before it.                                                                                             |
| R2 storage              | The storage limit of each plan. The staging keys go after `1 day`, and each dump after `35 days` (record 0199).                                                                                                    |
| R2 operations           | `NOTESAPP_OBJECT_WRITE_CAP` of `1000000` writes and `NOTESAPP_OBJECT_READ_CAP` of `10000000` reads a month (record 0193). Both stay in the free part of R2.                                                        |
| Transfer to readers     | The published limit of each plan, and `NOTESAPP_PUBLISHED_TRANSFER_CAP_BYTES` of `50 GB` a month.                                                                                                                  |
| Transfer to devices     | The download limit of each plan, and `NOTESAPP_DOWNLOAD_CAP_BYTES` of `50 GB` a month.                                                                                                                             |
| Requests from strangers | Cloudflare absorbs a flood at no fee. The one rate rule counts each address on paths that start with `/api/`, at most `300` requests in `10 s`, and blocks for `10 s`. The counters of record 0121 stay behind it. |
| Accounts that never pay | They are `locked` and removed after `30 days`. The proof of work and the address check of design 016 stay.                                                                                                         |
| Mail                    | The free plan of Resend, the mail budget of each address, and `20` seat invitations for each subscription in a day.                                                                                                |
| WebSocket connections   | The bounds of record 0129.                                                                                                                                                                                         |
| Imports and exports     | The job bounds of record 0170, and the download limit.                                                                                                                                                             |

- The rate rule cannot name a host on the free plan. The webhook of Paddle
  arrives at `/paddle/events` of the billing host, which the rule does not
  match, so a burst of deliveries is never blocked.
- Each number follows the limits of the chosen services: the free part where one exists, and a worst month under the hard limit where none exists.
- The hard limit trades an outage for a bounded bill. The owner raises it as
  revenue grows.
- **Alarms** by mail to the owner: the usage alert of Railway, a failed
  deploy, a free external check of `/ready`, a volume near its cap, a mail
  refused by Resend, a cap of record 0193 past half and when reached, a dump
  that failed or is older than `8 days`, a difference that the reconcile job
  repaired, and a duplicate subscription. The billing service reads the totals
  of record 0193 through the operator API and sends the cap alarms.

## Consequences

- Each cost that use drives has a hard bound: the Railway bill, the R2
  operations and the transfer. R2 storage grows with the plans that pay for
  it. A flood costs nothing, because Cloudflare absorbs it before Railway.
- A cap protects the bill of the whole service, so one account can reach it
  for everybody. The alarm at half lets the owner act first.
- A full mail plan stops the sign-up mails until the owner moves to a paid
  plan of Resend, and the alarm says so.
- The cloud outgrows these limits with revenue. Each step up is a dashboard
  change and a new record that supersedes this one.

# 0200. Every cost of the cloud has a limit

- Status: Accepted
- Date: 2026-10-04

## Context

Railway charges for the CPU, the memory, the volume and the egress that the
services use. R2 charges for storage past its free part. Resend refuses mail
past its free plan. The owner gives the cloud a monthly budget of `$20`. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

| What costs money             | The limit that holds it                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The whole Railway bill       | A usage alert at `$20` and a hard usage limit at `$30`. Past the hard limit Railway stops the services.                |
| Compute                      | Two replicas of `app` and one of `billing`. The owner adds a replica by hand.                                          |
| The database volume          | The text and history limit of each plan. The Hobby plan caps a volume at `5 GB`, and the owner moves to Pro before it. |
| Object storage in R2         | The storage limit of each plan, checked by the database for each write.                                                |
| Transfer to readers of pages | The limit of each plan, and `NOTESAPP_PUBLISHED_TRANSFER_CAP_BYTES` of `100 GB` a month for the service (record 0193). |
| Transfer to devices          | The storage limit, times the devices that hold a session. The sessions of an account are bounded.                      |
| Requests from strangers      | Cloudflare absorbs a flood at no fee. A rate rule for each address on each host, and the counters of record 0121.      |
| Accounts that never pay      | They are `locked` and removed after `30 days`. The proof of work and the address check of design 016 stay.             |
| Mail                         | The free plan of Resend, the mail budget of each address, and `20` seat invitations for each subscription in a day.    |
| WebSocket connections        | The bounds of record 0129.                                                                                             |
| Imports and exports          | The job bounds of record 0170.                                                                                         |

- The hard limit trades an outage for a bounded bill. The owner raises it as
  revenue grows.
- **Alarms** by mail to the owner: the usage alert of Railway, a failed
  deploy, a free external check of `/ready`, a volume near its cap, a mail
  refused by Resend, a difference that the reconcile job repaired, and a
  duplicate subscription.

## Consequences

- Each line of the bill has a hard bound. The cost of a flood is no longer the
  exception, because Cloudflare absorbs it before Railway.
- A full mail plan stops the sign-up mails until the owner moves to a paid
  plan of Resend, and the alarm says so.
- The cloud outgrows these limits with revenue. Each step up is a dashboard
  change and a new record that supersedes this one.

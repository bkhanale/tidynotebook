# 0199. The cloud runs on Railway behind Cloudflare

- Status: Accepted
- Date: 2026-10-04

## Context

The cloud needs the image, PostgreSQL with three roles, row level security,
advisory locks and `LISTEN`, object storage, mail, TLS and abuse control, and
the owner gives it a monthly budget of `$20`. AWS with a load balancer and a
managed database costs many times that before the first customer. One host
does not scale. Cloudflare holds the domain (record 0187). See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- **Railway**, on the Hobby plan, in the EU West region. One project holds:
  - `app`: the public image with the command `serve` of record 0202, two
    replicas, with no migration credential;
  - `billing`: the image of the billing service, one replica;
  - `migrate`: the public image with the command `migrate`, run once for
    each deploy with the migration role;
  - `postgres`: the PostgreSQL template of Railway, with point-in-time
    recovery and a daily volume backup. Its superuser makes the migration role
    once, as `docs/guide/self-hosting.md` states.
- The billing service calls the operator API of record 0190 over the private
  network of Railway.
- **Cloudflare**, on the free plan: DNS and the proxy for every host, the SSL
  mode `Full` that Railway requires for a proxied custom domain, the rules of
  record 0200, R2 for uploads and attachments (record 0192),
  static hosting of the site and the guide, and Email Routing that forwards
  `support@tidynotebook.com` to the owner.
- `NOTESAPP_TRUSTED_PROXIES` names the proxies in front of the core, for the
  counters of record 0121.
- **Mail.** Resend sends from `mail.tidynotebook.com` with DKIM, through the
  SMTP settings of record 0150, on its free plan.
- **Probes.** The probe operations of record 0040 skip the Host allowlist of
  record 0039, because Railway checks a replica with the host
  `healthcheck.railway.app`. A probe answer holds no address and no cookie.
- **A copy off the platform.** A weekly job writes a logical dump of each
  database to a separate R2 bucket. A lifecycle rule of that bucket deletes
  each dump after `35 days`, and the privacy notice states that time.
- **Deploy.** A workflow of the private repository takes a release, runs
  `migrate`, rolls `app` to its tag, deploys `billing`, and publishes the site
  and the guide, after the approval of the owner.
- **Staging** is a Railway environment with the Paddle sandbox, made for the
  run before the launch and for a large change, and removed after it.
- The runbook of the private repository lists each dashboard setting of
  Railway and Cloudflare. No OpenTofu.

## Consequences

- The owner patches no host. A replica can be added in the dashboard.
- Cloudflare encrypts the traffic to Railway but does not check the
  certificate of Railway. The owner accepts that, because Railway does not
  support the strict mode behind the proxy.
- The database has no standby. A failure of it stops the service until
  Railway restarts it or the owner restores it.
- An integration test sends a probe with the host of Railway, and a normal
  route with the same host still answers `host_not_allowed`.

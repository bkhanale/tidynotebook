# 0197. The cloud runs on AWS from OpenTofu in infra

- Status: Accepted
- Date: 2026-10-04

## Context

The cloud needs the image, PostgreSQL with three roles, row level security,
advisory locks and `LISTEN`, object storage, mail, TLS and abuse control. A
platform of one small vendor limits the database roles, one host does not
scale, and Kubernetes is a second product to run. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- AWS in `eu-central-1`, with backup copies in `eu-west-1`. One organization
  holds a management account, a staging account and a production account.
- `infra/` holds OpenTofu code: modules in `infra/modules/`, and one root for
  each environment in `infra/environments/staging` and
  `infra/environments/production`. The state lives in an S3 bucket of each
  account with the native lock file. No account identifier and no secret is
  committed.
- One VPC over two zones. The load balancer and the tasks sit in public
  subnets, each task with a public address, a task takes traffic only from
  the load balancer, and the database sits in private subnets. No NAT
  gateway. A gateway endpoint reaches S3.
- One ECS service on Fargate, ARM64 tasks of `1 vCPU` and `2 GB`, from two to
  six tasks, scaled on CPU. The default ephemeral storage of a task holds the
  temporary files, because record 0170 bounds the imports. An application load balancer with AWS WAF, and an
  idle timeout above the heartbeat of record 0129. `NOTESAPP_TRUSTED_PROXIES`
  names the VPC range.
- The probe operations of record 0040 skip the Host allowlist of record 0039,
  because a load balancer checks a target by its address, and a probe answer
  holds no address and no cookie.
- RDS for PostgreSQL 18 in two zones, `db.t4g.medium` in production and a
  single `db.t4g.small` in staging, with backups for `35 days`, deletion
  protection and a daily copy to `eu-west-1`.
- One S3 bucket for attachments (record 0196), with versioning and a replica
  in `eu-west-1`. S3 and CloudFront serve the site and the guide.
- SES sends mail from `mail.tidynotebook.com` with DKIM, through the SMTP
  settings of record 0150. Fastmail receives `support@tidynotebook.com`.
- Route 53 holds both zones, ACM the certificates, Secrets Manager every
  secret. The migration runs as its own ECS task with the migration role, and
  the serving task never holds that secret.
- The release workflow builds the image for `amd64` and `arm64`.
  `.github/workflows/deploy.yml` takes a release and an environment, copies
  the image to the ECR of that account, runs `pnpm billing:check`, runs the
  migration task, rolls the service, and publishes the site and the guide.
  It reaches AWS through OIDC, and production needs the approval of the owner.
- The owner applies `infra/` with `tofu apply` from a workstation, through
  IAM Identity Center. A deploy never applies infrastructure.

## Consequences

- No host to patch, a standby database, and recovery to any second of the
  backup window.
- `pnpm infra:check` runs `tofu fmt -check` and `tofu validate` for both
  environments, and it is part of `pnpm verify`. OpenTofu joins the toolchain
  of `docs/development/toolchain.md`. The deploy workflow runs `tofu plan`
  and stops on a change that nobody applied.
- `docs/development/cloud.md` states the shape, the deploy and the recovery.

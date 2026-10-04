# Plan 019: Tidy Notebook Cloud

Status: active

The [project board](https://github.com/users/bkhanale/projects/2) holds the live
work. Each item below becomes one issue, with its milestone, a priority label
and an area label. [Design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md)
states the problem and the choices. Every choice is closed. An item that finds
a fact in the code that a record did not foresee stops and reports it, as
`build-it-right` asks.

## Decisions

- [0186. One code base serves a paid cloud and a free self-hosted edition](../decisions/0186-one-code-base-serves-a-paid-cloud-and-a-free-self-hosted-edition.md)
- [0187. The product is Tidy Notebook on two domains](../decisions/0187-the-product-is-tidy-notebook-on-two-domains.md)
- [0188. The repository opens under AGPL-3.0-only](../decisions/0188-the-repository-opens-under-agpl-3-0-only.md)
- [0189. Paddle is the merchant of record](../decisions/0189-paddle-is-the-merchant-of-record.md)
- [0190. A plan is a row of one catalog and differs only in limits](../decisions/0190-a-plan-is-a-row-of-one-catalog-and-differs-only-in-limits.md)
- [0191. A subscription buys seats and a seat covers one account](../decisions/0191-a-subscription-buys-seats-and-a-seat-covers-one-account.md)
- [0192. An account with no plan reads and keeps its notes for a fixed time](../decisions/0192-an-account-with-no-plan-reads-and-keeps-its-notes-for-a-fixed-time.md)
- [0193. One function applies a subscription and webhooks feed it](../decisions/0193-one-function-applies-a-subscription-and-webhooks-feed-it.md)
- [0194. A checkout opens a transaction that this server creates](../decisions/0194-a-checkout-opens-a-transaction-that-this-server-creates.md)
- [0195. The landing site is a static site of its own](../decisions/0195-the-landing-site-is-a-static-site-of-its-own.md)
- [0196. An attachment can live in S3](../decisions/0196-an-attachment-can-live-in-s3.md)
- [0197. The cloud runs on AWS from OpenTofu in infra](../decisions/0197-the-cloud-runs-on-aws-from-opentofu-in-infra.md)
- [0198. Every cost of the cloud has a limit](../decisions/0198-every-cost-of-the-cloud-has-a-limit.md)

## Landing boundaries

1. Phase 1 is items 1 to 8, milestone `0.15.0`. It changes nothing that a
   self-hosted operator must act on, and it ships with billing `off`.
2. Phase 2 is items 9 to 16, milestone `0.16.0`. Items 9 to 13 share one
   branch and one landing, with one commit for each item, because
   `checkRegistration` in `apps/server/src/plugins/register.ts` stops startup
   when a contract operation has no handler.
3. Phase 3 is items 17 to 23, milestone `1.0.0`. Item 23 is the launch, and it
   lands last.
4. Each item follows `docs/development/feature-workflow.md`, updates the
   `AGENTS.md` of each directory it changes, and updates
   `docs/guide/configuration.md` in the same commit as each new setting.
5. Each item carries the tests that its records name, proves each new test
   fails before its change, and passes `pnpm verify`. Each changed screen gets
   a screenshot in light and in dark.
6. Rebase onto `main`, fast-forward merge, delete the branch. Never force push.

## Owner actions

These steps happen outside the code. Each one names the item that waits for
it.

| Action                                                                                                                                                                                                                                                                                                  | Needed by |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| O1. Buy `tidynotebook.com`, `tidynotebook.page` and `tidynotebook.app`. Claim the GitHub organization `tidynotebook`.                                                                                                                                                                                   | 19        |
| O2. Make the AWS organization with the management, staging and production accounts, and IAM Identity Center for the owner.                                                                                                                                                                              | 19        |
| O3. Open a Paddle sandbox account and a live account. Make the two products and the four prices of the catalog in each, set the default payment link to `/checkout` of the site, and add a notification destination for the `subscription.*` events at `/api/billing/paddle-events` of the application. | 12, 21    |
| O4. Write the terms, the privacy notice and the refund policy into `apps/site/content/`, from the templates of record 0148 and the refund rule of record 0189.                                                                                                                                          | 18        |
| O5. Ask Paddle to approve `tidynotebook.com` once item 20 has published the site there with its legal pages. Ask AWS for SES production access.                                                                                                                                                         | 23        |
| O6. Open the Fastmail mailbox `support@tidynotebook.com`.                                                                                                                                                                                                                                               | 23        |

## Work

| Item | Depends on     | Scope and owning paths                                                                                                                                                                                                                                                                                                                                                                                                                           | Records          |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1    | None           | `productName` in `packages/core/src/product.ts`. The web title and description in `apps/web/index.html`, the manifest in `apps/web/vite.config.ts`, the wordmark in `apps/web/src/features/accounts/accounts.tsx`, the mail in `apps/server/src/auth/messages.ts`, the README and the guide read it or are checked against it. A unit test refuses another spelling on a visible surface.                                                        | 0187             |
| 2    | None           | `NOTESAPP_BILLING` in `apps/server/src/config.ts`. The billing mode in the row of `installation_settings`, written at startup, read by the registration function, and the startup refusal when it differs and an account exists. One migration.                                                                                                                                                                                                  | 0186             |
| 3    | None           | `packages/core/src/billing/catalog.ts` and `retention.ts`: the plans, the prices, the limits, the intervals, the seat bounds and the retention times, with unit tests. Pure, no import.                                                                                                                                                                                                                                                          | 0190, 0192       |
| 4    | None           | `packages/storage-server/src/object-store/`: the port, the file adapter that `openAttachmentStore` uses today, the S3 adapter, `NOTESAPP_OBJECT_STORE` and the S3 settings, the storage probe. A MinIO service in `compose.test.yaml`, and one contract test for both adapters. `docs/guide/self-hosting.md` names the S3 choice.                                                                                                                | 0196             |
| 5    | 3              | Text bytes apart from attachment bytes in `workspace_usage`, and the second check of `notesapp_add_usage`. With billing `off` the text limit is absent. Integration tests with the use case bypassed.                                                                                                                                                                                                                                            | 0190             |
| 6    | 3              | The published transfer: the sum in memory and its flush in `apps/server/src/routes/published-document.ts` and the attachment route of the reader path, the monthly table and its function, the closed page past the limit of the account and past the cap of the whole service, and the state on the published links page. With billing `off` the transfer limit is absent and nothing is counted. Two server instances in the integration test. | 0198             |
| 7    | None           | The probe operations skip the Host allowlist in `apps/server/src/app.ts`. An integration test sends a probe with the address of the socket as its Host, and a normal route with the same Host still answers `host_not_allowed`.                                                                                                                                                                                                                  | 0197             |
| 8    | None           | `.github/workflows/release.yml` builds and pushes the image for `amd64` and `arm64`. `tools/release-check.mjs` checks both platforms in the manifest.                                                                                                                                                                                                                                                                                            | 0197             |
| 9    | 2, 3           | Contract in `packages/api-contract/`: `getBilling`, `startCheckout`, `openBillingPortal`, `previewSubscriptionChange`, `changeSubscription`, `keepSubscription`, the seat invitations, `removeMember`, `leaveSeat`, `receivePaddleEvent`, and the errors `plan_required`, `billing_off` and `billing_managed`. Run `pnpm generate`.                                                                                                              | 0191, 0194       |
| 10   | 9              | Rules in `packages/core/src/billing/`: coverage from a status, the seat rules, the checks of each operation, each refusal with its code. Ports for each store call.                                                                                                                                                                                                                                                                              | 0191, 0192       |
| 11   | 10             | One migration in `packages/storage-server/`: the subscription, the Paddle customer, the stored transaction, the event identifiers, the seat of an account, the coverage facts, the invitation target `seat`, the snapshot function, the seat functions, the `plan_required` check, the new lock order. Raise `requiredSchemaVersion`.                                                                                                            | 0191, 0192, 0193 |
| 12   | 11, O3         | `apps/server/src/billing/paddle.ts` on the SDK, the Paddle settings, `receivePaddleEvent` with the raw body, the hourly and daily jobs, `pnpm billing:sync` and `pnpm billing:check` in `apps/server/src/cli/`. The cursor of the hourly job, and a test that drops a cancellation event. Signed fixture events and a fake API in the tests.                                                                                                     | 0189, 0193       |
| 13   | 12             | Handlers of checkout, portal, preview, change, keep, seats, removal and leave. The daily limit of seat invitations of record 0198. The duplicate payment rule. The cancellation when a billing owner removes the account. The `billing` notice.                                                                                                                                                                                                  | 0191, 0193, 0194 |
| 14   | 11             | The daily removal job of `apps/server/src/jobs/` for an account past its time, and the mails of record 0192 in `apps/server/src/auth/messages.ts`. A seat invitation mail.                                                                                                                                                                                                                                                                       | 0192             |
| 15   | 9              | `packages/sync/src/queue.ts` keeps a save refused with `plan_required`. The editor opens read only and one notice row shows the reason, through a `.ts` rule beside each screen.                                                                                                                                                                                                                                                                 | 0192             |
| 16   | 13, 15         | Screens in `apps/web/src/features/`: the subscribe screen, the Plan and billing section of Settings, the seats of a billing owner, the view of a member, and the plan of each account on the accounts page. An address with no workspace opens in the selected one. Light and dark screenshots.                                                                                                                                                  | 0191, 0194       |
| 17   | 3              | `apps/site` with its `AGENTS.md`, the pages of record 0195, the build settings, `pnpm site:build` and `pnpm site:serve`, `tests/integration/site.test.ts`, and the import rules in `tools/check-boundaries.mjs`. Light and dark screenshots of each page.                                                                                                                                                                                        | 0195             |
| 18   | 17, O4         | The legal texts render on the site. The cloud names `/terms` and `/privacy` by address. `docs/guide/plans-and-billing.md` for a person on the cloud, listed in `docs/guide/README.md`.                                                                                                                                                                                                                                                           | 0195, 0189       |
| 19   | O1, O2         | `infra/` with its `AGENTS.md`: the modules and both environments of record 0197, the limits and alarms of record 0198, and `pnpm infra:check` in `pnpm verify`. OpenTofu in `docs/development/toolchain.md`.                                                                                                                                                                                                                                     | 0197, 0198       |
| 20   | 8, 19          | `.github/workflows/deploy.yml`: the copy to ECR, `pnpm billing:check`, the migration task, the roll of the service, the publish of the site and the guide, `tofu plan` with a stop on drift. `docs/development/cloud.md` with the deploy, the restore, the alarms and the flood runbook.                                                                                                                                                         | 0197             |
| 21   | 16, 18, 20     | Staging from end to end with the Paddle sandbox: a purchase, a second seat, a change of plan, a refund, a failed payment, a lapse, a webhook replay, a failover of the database and a restore of the database. A report of the run in `docs/audits/<date>/`.                                                                                                                                                                                     | All              |
| 22   | None           | `LICENSE` to AGPL-3.0-only, the license field of each `package.json`, `.github/workflows/dco.yml`, `CONTRIBUTING.md`, `SECURITY.md` and the README for two editions.                                                                                                                                                                                                                                                                             | 0188             |
| 23   | 21, 22, O5, O6 | The launch: production apply, the release `1.0.0` deployed, the guide moved to `docs.tidynotebook.com` with a redirect from the old address, the repository moved to the organization `tidynotebook` and opened.                                                                                                                                                                                                                                 | 0187, 0188       |

Items 1, 2, 3, 4, 7, 8 and 22 have no dependency and can land at any time.

## Required evidence

[Design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md) lists the
proof under "What the gate must prove". Each item carries the part that its
records name. A test that proves a refusal also proves that the database
refuses it with the use case bypassed.

# Plan 019: Tidy Notebook Cloud

Status: active

The [project board](https://github.com/users/bkhanale/projects/2) holds the live
work. Each item below becomes one issue, with its milestone, a priority label
and an area label. [Design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md)
states the problem and the choices. Every choice is closed. An item that finds
a fact in the code that a record did not foresee stops and reports it, as
`build-it-right` asks.

## Decisions

- [0186. The open core holds no billing, and a private service sells the cloud](../decisions/0186-the-open-core-holds-no-billing-and-a-private-service-sells-the-cloud.md)
- [0187. The product is Tidy Notebook on tidynotebook.com](../decisions/0187-the-product-is-tidy-notebook-on-tidynotebook-com.md)
- [0188. The repository opens under AGPL-3.0-only](../decisions/0188-the-repository-opens-under-agpl-3-0-only.md)
- [0189. An account carries limits, a standing and feature switches](../decisions/0189-an-account-carries-limits-a-standing-and-feature-switches.md)
- [0190. An operator API reaches the account controls](../decisions/0190-an-operator-api-reaches-the-account-controls.md)
- [0191. A published page of the cloud lives on the application origin](../decisions/0191-a-published-page-of-the-cloud-lives-on-the-application-origin.md)
- [0192. An attachment can live in an S3 compatible store](../decisions/0192-an-attachment-can-live-in-an-s3-compatible-store.md)
- [0193. Published transfer has a limit for each account and for the installation](../decisions/0193-published-transfer-has-a-limit-for-each-account-and-for-the-installation.md)
- [0194. Paddle is the merchant of record](../decisions/0194-paddle-is-the-merchant-of-record.md)
- [0195. Two plans: Standard for one person and Pro for a team](../decisions/0195-two-plans-standard-for-one-person-and-pro-for-a-team.md)
- [0196. The billing service mirrors Paddle into the account controls](../decisions/0196-the-billing-service-mirrors-paddle-into-the-account-controls.md)
- [0197. The billing pages and the checkout live on the billing service](../decisions/0197-the-billing-pages-and-the-checkout-live-on-the-billing-service.md)
- [0198. The landing site is a static site of the private repository](../decisions/0198-the-landing-site-is-a-static-site-of-the-private-repository.md)
- [0199. The cloud runs on Railway behind Cloudflare](../decisions/0199-the-cloud-runs-on-railway-behind-cloudflare.md)
- [0200. Every cost of the cloud has a limit](../decisions/0200-every-cost-of-the-cloud-has-a-limit.md)

## Landing boundaries

1. Phase 1 is items 1 to 11, in this repository, milestone `0.15.0`. It holds
   no billing, and a self-hosted operator needs no action for it. Items 2 to 6
   share one branch and one landing, with one commit for each item, because
   `checkRegistration` in `apps/server/src/plugins/register.ts` stops startup
   when a contract operation has no handler.
2. Phase 2 is items 12 to 15, in the private repository `tidynotebook/cloud`.
   Its issues sit on the same board.
3. Phase 3 is items 16 to 18, milestone `1.0.0`. Item 18 is the launch, and
   it lands last.
4. Each item of this repository follows
   `docs/development/feature-workflow.md`, updates the `AGENTS.md` of each
   directory it changes, and updates `docs/guide/configuration.md` in the same
   commit as each new setting.
5. Each item carries the tests that its records name, proves each new test
   fails before its change, and passes `pnpm verify`. Each changed screen gets
   a screenshot in light and in dark.
6. Rebase onto `main`, fast-forward merge, delete the branch. Never force push.

## Owner actions

These steps happen outside the code. Each one names the item that waits for
it.

| Action                                                                                                                                                                                                                                                                                                | Needed by |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| O1. Claim the GitHub organization `tidynotebook` and make the private repository `tidynotebook/cloud`. The domain `tidynotebook.com` is already bought at Cloudflare.                                                                                                                                 | 12        |
| O2. Open a Railway account on the Hobby plan. Turn on R2 in Cloudflare. Open a Resend account and verify `mail.tidynotebook.com`.                                                                                                                                                                     | 16        |
| O3. Open a Paddle sandbox account and a live account. Make the two products and the four prices of the catalog in each, set the default payment link to `/checkout` of the billing service, and add a notification destination for the `subscription.*` events at the webhook of the billing service. | 13, 17    |
| O4. Write the terms, the privacy notice and the refund policy for the site, from the templates of record 0148 and the refund rule of record 0194.                                                                                                                                                     | 15        |
| O5. Ask Paddle to approve `tidynotebook.com` once item 16 has published the site with its legal pages.                                                                                                                                                                                                | 18        |
| O6. Ask a chartered accountant how to treat the Paddle payouts for GST and income tax in India.                                                                                                                                                                                                       | 18        |
| O7. Add `app.tidynotebook.com` to Google Search Console, so a block of a published page shows at once.                                                                                                                                                                                                | 18        |

## Work

| Item | Depends on   | Scope and owning paths                                                                                                                                                                                                                                                                                                                                                                    | Records          |
| ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1    | None         | `productName` in `packages/core/src/product.ts`. The web title and description in `apps/web/index.html`, the manifest in `apps/web/vite.config.ts`, the wordmark in `apps/web/src/features/accounts/accounts.tsx`, the mail in `apps/server/src/auth/messages.ts`, the README and the guide read it or are checked against it. A unit test refuses another spelling on a visible surface. | 0187             |
| 2    | None         | Contract in `packages/api-contract/`: the `operatorToken` scheme, the operator operations, `openAccountPortal`, the controls on the account operations of an administrator, and the errors `account_locked` and `operator_off`. Run `pnpm generate`.                                                                                                                                      | 0189, 0190       |
| 3    | 2            | One migration in `packages/storage-server/`: text bytes apart from attachment bytes in `workspace_usage`, the controls on the account row, the second check and the `account_locked` refusal of `notesapp_add_usage`, the account events, the handoff tokens. The settings of a new account in `apps/server/src/config.ts`. Raise `requiredSchemaVersion`.                                | 0189, 0190       |
| 4    | 3            | The `locked` account: each use case refuses `account_locked` except export and removal, the reader path closes its links, `packages/sync/src/queue.ts` keeps a refused save, the one screen of a locked account with the portal link, and the controls on the accounts page of an administrator. Light and dark screenshots.                                                              | 0189             |
| 5    | 3            | The daily removal job of `apps/server/src/jobs/` for a `locked` account past its time, and its mails in `apps/server/src/auth/messages.ts`.                                                                                                                                                                                                                                               | 0189             |
| 6    | 3            | The operator handlers: the token from `NOTESAPP_OPERATOR_TOKEN_FILE`, find, read, set controls, remove, the event list after a cursor, the handoff, and the skip of the Host allowlist.                                                                                                                                                                                                   | 0190             |
| 7    | None         | The `open` policy accepts an installation with no published origin.                                                                                                                                                                                                                                                                                                                       | 0191             |
| 8    | None         | `packages/storage-server/src/object-store/`: the port, the file adapter that `openAttachmentStore` uses today, the S3 adapter, `NOTESAPP_OBJECT_STORE` and the S3 settings, the storage probe. A MinIO service in `compose.test.yaml`, and one contract test for both adapters. `docs/guide/self-hosting.md` names the S3 choice.                                                         | 0192             |
| 9    | 3            | The published transfer, counted at the response boundary of `apps/server/src/routes/published.ts`, the sum in memory and its flush, the monthly table, the closed page past the limit of an account and past `NOTESAPP_PUBLISHED_TRANSFER_CAP_BYTES`, and the state on the published links page. Two server instances in the integration test.                                            | 0193             |
| 10   | None         | The probe operations skip the Host allowlist in `apps/server/src/app.ts`. An integration test sends a probe with the host of Railway, and a normal route with that host still answers `host_not_allowed`.                                                                                                                                                                                 | 0199             |
| 11   | None         | `LICENSE` to AGPL-3.0-only, the license field of each `package.json`, `.github/workflows/dco.yml`, `CONTRIBUTING.md`, `SECURITY.md` and the README for two editions.                                                                                                                                                                                                                      | 0188             |
| 12   | O1           | Private repository: the billing service with its database and role, the catalog, the Paddle module on the SDK, the check command, and a test stack that runs the public image of the core.                                                                                                                                                                                                | 0186, 0194, 0195 |
| 13   | 6, 12, O3    | The webhook, the snapshot function, the coverage through the operator API, the daily reconcile job, the reader of the account events, the duplicate rule, and the mail when a plan ends. Signed fixture events and a fake Paddle API in the tests.                                                                                                                                        | 0196             |
| 14   | 13           | The billing pages: the handoff and the session, the choice of a plan, the checkout, the customer portal, the seats and their invitations, the view of a member, the change of plan, count and interval with a preview.                                                                                                                                                                    | 0195, 0197       |
| 15   | 12, O4       | The landing site with the pages of record 0198 and its test against the catalog. The page about plans and billing.                                                                                                                                                                                                                                                                        | 0198             |
| 16   | 1 to 15, O2  | Railway and Cloudflare as record 0199 states, the limits and alarms of record 0200, the weekly dump to R2, the deploy workflow, and the runbook with the deploy, the restore and every dashboard setting.                                                                                                                                                                                 | 0199, 0200       |
| 17   | 16           | Staging from end to end with the Paddle sandbox: a purchase, a second seat, a change of plan, a refund, a failed payment, a lapse, a webhook replay, a removal, and a restore of the database. A report of the run in the private repository.                                                                                                                                             | All              |
| 18   | 17, O5 to O7 | The launch: release `1.0.0` deployed to production, the guide moved to `docs.tidynotebook.com` with a redirect from the old address, the repository moved to the organization `tidynotebook` and opened.                                                                                                                                                                                  | 0187, 0188       |

Items 1, 2, 7, 8, 10 and 11 have no dependency and can land at any time.

## Required evidence

[Design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md) lists the
proof under "What the gate must prove". Each item carries the part that its
records name. A test that proves a refusal also proves that the database
refuses it with the use case bypassed.

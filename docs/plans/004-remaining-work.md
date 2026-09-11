# Remaining work

The living list of what is not finished. It is ordered by priority, so the
top row is always the next thing to do.

Audited against `73957bb` on 2026-09-11. Every row names the audit id from
[the v0.1 revamp plan](003-v0.1-revamp.md) section 4 and the file that proves
the state. Update this file in the same change that closes a row.

Status values: `open`, `partial` (the code changed but the proof or a part is
missing), `accepted` (a decision was made to carry it).

## Where v0.1 stands

| Priority | Done        | Partial | Open |
| -------- | ----------- | ------- | ---- |
| P0       | 19          | 0       | 0    |
| P1       | 48          | 11      | 5    |
| P2       | not audited |         |      |

Every P0 item of the plan is merged. The rows below are P1 and lower.

## 1. Before the 0.1.0 tag

| Id     | Item                                               | Status | Evidence                                                                                                                                                                                                                                                            |
| ------ | -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-27  | Rate limit the setup and the authentication routes | open   | No rate limit plugin or configuration in `apps/server/src/app.ts` or `src/auth/better-auth.ts`, and no such dependency in `apps/server/package.json`                                                                                                                |
| ENG-12 | Do not ship the source maps in the image           | open   | `apps/web/vite.config.ts:237` sets `sourcemap: 'hidden'`, which only drops the comment. 17 `.map` files reach `apps/web/dist/web/assets/`, the Dockerfile copies that directory, `static-assets.ts:43` gives `.map` a content type, and nothing refuses the request |

Both are small, and both are about a deployment that faces the internet.
Decision record 0013 states that source maps are hidden, so the second row is
also a gap against a decision that is already accepted.

## 2. Security and deployment

| Id                  | Item                                              | Status  | Evidence                                                                                                                                                                      |
| ------------------- | ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-26, BE-31, QA-17 | `Content-Disposition` on an attachment download   | partial | `nosniff` is on every response (`src/http/security-headers.ts:120`), but `src/http/attachments.ts` sets only `content-length` and `etag`. Only `export.ts` sets a disposition |
| BE-28               | Per route timeout for the attachment upload       | open    | `src/http/attachments.ts` has no route timeout. Only the global `requestTimeout` in `app.ts:148` applies                                                                      |
| BE-97               | Optional Caddy profile with TLS, and `trustProxy` | open    | No `Caddyfile` and no compose profile. No `trustProxy` anywhere in `apps/server/src` or `docker-compose.yml`                                                                  |

## 3. Correctness and product gaps

| Id           | Item                                              | Status  | Evidence                                                                                                                                                                 |
| ------------ | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BE-09        | Revalidate IndexedDB in bounded chunks, or lazily | open    | `packages/storage-browser/src/migrations.ts:487` calls `.toArray()` on every table. Its own comment says "This reads the whole database"                                 |
| MD-25, QA-25 | Hide the fence info string in the live preview    | partial | Alignment and per language fences are done. `packages/editor/src/live-preview.ts:437` always shows the info string, and `live-preview.test.ts:264` asserts that it stays |
| BE-88        | Reduce the action set                             | partial | `Role` is one value (`packages/core/src/identity/actor.ts:17`), but `Action` still has four members: `read`, `write`, `history`, `purge`                                 |
| ENG-13       | Replace `vite-plugin-pwa` and `workbox-build`     | open    | Both are still in `apps/web/package.json`, and `vite.config.ts:5` still imports `VitePWA`                                                                                |

## 4. Proof that is missing

The code looks right, but no test holds it.

| Id                         | Item                                                                           | Status  | Evidence                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| MD-07, UI-04, QA-28        | Remove the wiki links and the backlinks                                        | partial | Production code is clean, but `tests/e2e/features.spec.ts:51` still clicks a `Backlinks` button that no longer exists. That spec fails if it runs |
| UI-13                      | Button accessible names match the visible label                                | partial | No test asserts it                                                                                                                                |
| UI-14, UI-15               | Danger tokens and sidebar contrast                                             | partial | The tokens exist in `packages/ui/src/theme.ts`, but no automated contrast check covers them                                                       |
| QA-16, UI-30, UI-31, QA-40 | Phone: no overflow, 44 px targets                                              | partial | `playwright.config.ts` has the `phone-390` project, but no spec asserts a touch target size                                                       |
| ENG-10, ENG-17, ENG-18     | Browser journeys for history restore, attachment round trip, and trash restore | partial | `tests/e2e/offline.spec.ts` covers the offline reload. No spec covers the other three                                                             |
| W1 test gaps               | A regression test for each W1 data loss case                                   | partial | `tests/integration/revisions.test.ts:633` and `problem.test.ts` cover part. Not all four cases are enumerated as closed                           |
| MD-10                      | Per keystroke cost of the live preview                                         | open    | No benchmark and no performance test, so the property cannot be confirmed                                                                         |
| ENG-05 to ENG-08           | A boundaries guide                                                             | partial | The boundary rules live in `docs/development/architecture.md` and `toolchain.md`. There is no `docs/development/boundaries.md`                    |

## 5. Accepted debt

These are carried on purpose. They do not block a release.

| Id                     | Item                        | Why it is carried                                                                                                                                                           |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ENG-12                 | Initial JavaScript budget   | 299,385 gzip bytes against a 256,000 budget. The owner judged the real user impact small for a self hosted single user application. Revisit when the editor is next touched |
| ENG-01                 | The CI matrix on GitHub     | `ci.yml` is `disabled_manually` because no CI budget is allocated. Every check runs on the local machine instead. The plan is to move it to a self hosted runner            |
| ENG-10, ENG-17, ENG-18 | The thorough browser matrix | The owner wants the browser suite built once the feature surface settles, so it is the last block of work before a wider release, not a gate for 0.1.0                      |

Because the CI workflow is off, "green in CI" in
[the plan](003-v0.1-revamp.md) section 8 is read as "green on the local
machine". `pnpm verify` passed on `73957bb` with 821 unit tests and 229
integration tests.

## 6. Not audited

Plan section 4 holds 43 P2 rows. They were not checked one by one, because
P2 is defined as v0.2 work unless a phase has capacity. Two rows are marked
Drop and need no action: BE-20, the viewer downgrade logic, and BE-87, the
`mcp-operations` fallback.

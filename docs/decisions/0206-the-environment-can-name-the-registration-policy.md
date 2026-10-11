# 0206. The environment can name the registration policy

- Status: Accepted
- Date: 2026-10-05

## Context

The registration policy, `invitation` or `open`, lives in the one row of
`installation_settings` (record 0108). Only an administrator changes it,
through `updateInstallation` and the accounts page. An installation that is
set up as code, as the cloud of
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md) is, then
needs a step in a browser for each environment. Record 0148 already lets the
environment set the mail transport and the legal documents: a group that the
environment sets wins and is locked. The SQL gate of the `open` ground in
`notesapp_register_account` reads the stored policy, so a policy that only
the application read would not reach it.

## Decision

- `NOTESAPP_REGISTRATION_POLICY` names the policy, `invitation` or `open`.
  `apps/server/src/config.ts` reads it. With no value, the administrator sets
  the policy as before.
- A policy that the environment names wins and is locked. The decider of
  record 0148, `apps/server/src/installation-settings.ts`, states it, and
  `setRegistrationPolicy` in `packages/core` answers `setting_locked` to a
  change. `getInstallation` answers `registrationPolicySource`, so the
  accounts page states the lock and offers no change.
- At each start the server writes the named policy into the row, through the
  SQL function `notesapp_apply_registration_policy` of migration 0032, under
  the installation lock. The runtime role is the server itself, so the
  function checks no administrator, as the counters of migration 0013 check
  none. The SQL gate, the sign-up and the accounts page then read one value.
  The migrate command of record 0202 runs before the serve command, so the
  function is there.
- `open` from the environment needs the parts that records 0114, 0120 and
  0191 name, from the environment too: a mail transport and both legal
  documents. A missing part stops the start, and the message names the
  variable and never a value. The whole open set then has one source, and no
  change in the application can remove a part that it needs.
- Removing the variable unlocks the setting. The row keeps the last policy
  that the environment named.

This refines records 0108, 0114 and 0148. It excludes a policy that the
server reads from the environment at each request, because the SQL gate reads
the row.

## Consequences

- An installation set up as code needs no step in a browser for the policy.
- A rolling start of two releases can briefly disagree, until the next start
  of the older process. The newer process writes the policy at its start.
- `apps/server/src/config.test.ts` proves the variable and each refusal of
  `open`, `packages/core` the lock, and
  `tests/integration/installation-settings.test.ts` the stored row, the
  served source, the refused change and the unlock.

# 0129. The notice gateway and its bounds

- Status: Accepted
- Date: 2026-09-28

## Context

Records 0124 and 0125 choose PostgreSQL notices, a gateway in each server
process, and shared admission, and they leave the names, the bounds and the
shapes to the implementation of
[issue 189](https://github.com/bkhanale/notesapp/issues/189). Record 0128
defines the frame boundary.

## Decision

- **One channel.** Every hint goes on the PostgreSQL channel `notesapp_sync`.
  The payload is `w:` and a workspace id, `s:` and a session id, `a:` and an
  account id, or `p` for a change of the publishing switch. A session id is not
  its token (record 0122). No other value enters a hint.
- **Triggers.** A statement trigger on `sync_changes` sends one `w:` hint per
  changed workspace. A statement trigger on the deletion of a session sends
  `s:`, and one on a change of the state or the removal of an account sends
  `a:`. Every trigger reads the one row of `sync_publishing` first and sends
  nothing while it is off. Setting the switch sends `p` in both directions.
- **Switches.** `sync_publishing` is off by default. The operator command
  `pnpm notices:publishing` sets it. Admission is a second switch,
  `NOTESAPP_SYNC_NOTICES`, off by default. A stream opens only when both are on
  and the listener of the process is up.
- **Access.** A stream binds to the session id and the account of its upgrade,
  and the upgrade must name an application origin. Before each outbound batch,
  and on a timer, one function answers the workspaces that the session may
  still read. No positive answer is cached. A lost session stops the stream
  with `session_ended`. A workspace that the account can no longer read leaves
  the set, and no notice names it again.
- **Shared admission.** `packages/storage-server/src/coordination.ts` reserves
  one row per stream in `stream_reservations`, with an expiry that the gateway
  renews. The reservation counts the streams of the account across processes.
  A process caps its own streams too. An admission that the shared store cannot
  answer is refused.
- **Listener.** One pooled client from `openPool` holds the `LISTEN`. A gap
  shorter than the grace period ends with `reconcile` to every stream. A longer
  gap stops every stream with `unavailable`.
- **Bounds.** The limits are named constants in `apps/server/src/notices/`:
  frame bytes, client messages per minute, outbound buffer bytes, heartbeat,
  grace, renewal, and streams per account and per process. A breach stops the
  stream.
- **Queue failure.** A notice that PostgreSQL cannot queue fails the commit.
  The request answers a failure and writes no receipt, so the queued mutation
  of the device sends again.

This excludes an outbox, a relay, a broker, a notice cursor, and a cache of
access answers.

## Consequences

Real database tests prove each writer, rollback, receipt replay, the switch,
and a failed commit. Two server instances prove fan-out, revocation, the gap,
and the shared limit. `tests/integration/sync-notices.test.ts` holds them.

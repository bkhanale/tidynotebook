# Release recovery

Read preparation with `pnpm release:prepare --status`. Resume its source,
version, notes and review with `pnpm release:prepare --resume`. A gate failure
is source work before publication. Keep its tested image identity fixed.

Read publication with `pnpm release "$VERSION" --status`. Publication reads
the remote prepared assets and registry digest. It needs no local receipt.
Retry the same version after an uncertain write. The command reads remote state
before another write. A differing asset, version tag, image or repository is
a stop. Never overwrite it. Milestone work is separate.

A local lock does not expire on a timer. Read the named process and worktree.
Remove a stale lock only when its process is gone and no other work owns it.

# Release recovery

Read `pnpm release --status` before a write. Keep the source, repository, tag,
version, tested image, and published digest fixed. A pending review is a wait.
Resume when its completion event arrives. A gate failure is a fix before a tag.
An absent registry image can resume its saved write. A different image is a stop.

A lock does not expire on a timer. Read the named process and its worktree.
Remove a stale lock only after its process is gone and no other work owns it.
An uncertain external write needs a current read. A missing exact release asset
can be uploaded after that read. A differing asset, tag, or repository is a stop.
Do not overwrite it. Record the state and the next safe action.

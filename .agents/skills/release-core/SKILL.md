---
name: release-core
description: Publishes a core version through a locked resumable release command. Use for an explicit core release request, optional version override, or an interrupted core release. A build request does not trigger it.
---

# Release core

Start with an explicit release request and a clean current main in the owned
worktree. Read saved status first for an interrupted release. The command derives
the version and notes from reviewed merged PR metadata. The strongest release
type wins. Before stability, a breaking change takes the next minor step.

```sh
pnpm release
pnpm release --status
pnpm release --resume
```

An optional positional version can raise the derived step. Use `--dry-run` to
inspect the plan. The default command performs the authorized release chain.
When it waits for prepare review, apply [review-change](../review-change/SKILL.md)
to the prepare PR, then resume. When it waits for the image job, read the event
and resume after completion. Do not poll without a bound.

The command owns notes, prepare landing, exact proof, signed fixed tag, published
image provenance, release assets, milestone, and after proof. It saves each stage.
Missing exact assets can be added after a read. Differing assets or tags stop.
A failed image after tag publication needs the next patch. Never move a tag.
Read [release recovery](reference/recovery.md) only for a failed or uncertain
stage. End when status says complete and names the fixed source and image.

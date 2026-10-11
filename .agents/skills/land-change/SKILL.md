---
name: land-change
description: Lands an authorized core PR after current proof and checks. Use when the session permits landing. A review is optional. It does not release or deploy.
---

# Land change

Start with an authorized PR and current proof. Rebase onto current main when
needed, then prove the new head. Never force push. A pushed branch
that needs history changes gets a new branch and a new PR.

```sh
pnpm lifecycle land <PR> --execute
```

The command reads current checks and review threads, requires no review, pushes the exact proved head without force, and reads the merged result. A pending or uncertain write needs a read
before another write. End when saved state names the actual merged commit.
Branch and worktree cleanup remains a separate owner action.

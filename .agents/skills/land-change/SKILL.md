---
name: land-change
description: Lands an authorized core PR after current proof, checks, and final-head review. Use when review is complete and the session permits landing. It does not release or deploy.
---

# Land change

Start with an authorized PR and current proof. Rebase onto current main when
needed, then prove and review the new head. Never force push. A pushed branch
that needs history changes gets a new branch and a new PR.

```sh
pnpm lifecycle land <PR> --execute
```

The command reads current checks and review threads, pushes the exact reviewed head without force, and reads the merged result. A pending or uncertain write needs a read
before another write. End when saved state names the actual merged commit.
Branch and worktree cleanup remains a separate owner action.

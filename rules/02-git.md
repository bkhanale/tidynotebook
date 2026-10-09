# Git and GitHub

- Use conventional commits.
- Never force push.
- Do not use a bare `#N` in a GitHub comment or pull request body. Write
  `item 1`, `(2)`, or a plain list. Use `#NNNN` only for a real pull request or
  issue.
- Work happens in a git worktree on a short-lived branch.
- Before a branch lands, `pnpm verify` must pass.
- A change lands through a reviewed pull request. Prove its exact head with
  `pnpm verify`. Resolve the findings of Codex for that head. The current
  remote main must be its ancestor. Push that exact head to main without force.
  A rejected push is a stop, never a reason to bypass a protection.
- `tools/lifecycle.mjs` reads the PR and merged tree before it saves landing
  proof. A build request includes this review and landing only when the session
  permits landing. A build request never permits release or live deployment.
- A pull request shows its screenshots through `tools/pr-screenshots.mjs`,
  which adds them to the `pr-screenshots` branch. Never delete that branch.
- Stay inside the active worktree. All edits, commits, and untracked files
  belong in that worktree.
- Only the owner starts the `cleaning-up-after-a-task` skill. Never run it on
  your own, and never remove another worktree, another branch, or Docker data
  outside it.
- A release follows the `release-core` skill, from the changelog entry
  to the signed tag, the GitHub release, and the milestone. Prove each step
  with `node tools/release-check.mjs`. A pushed tag is never moved and never
  deleted.

# Git and GitHub

- Use conventional commits.
- Never force push.
- Do not use a bare `#N` in a GitHub comment or pull request body. Write
  `item 1`, `(2)`, or a plain list. Use `#NNNN` only for a real pull request or
  issue.
- Work happens in a git worktree on a short-lived branch.
- Before a branch lands, `pnpm verify` must pass.
- A change lands through a pull request. Prove its exact head with
  `pnpm verify`. A review is optional (record 0218). The owner may ask for one,
  and then fix each open finding of it. The current remote main must be an
  ancestor of the head. Push that exact head to main without force. A rejected
  push is a stop, never a reason to bypass a protection.
- `tools/lifecycle.mjs` reads the PR and merged tree before it saves landing
  proof. A build request includes this landing only when the session
  permits landing. A build request never permits release or live deployment.
- A pull request shows its screenshots through `tools/pr-screenshots.mjs`,
  which adds them to the `pr-screenshots` branch. Never delete that branch.
- Stay inside the active worktree. All edits, commits, and untracked files
  belong in that worktree.
- Only the owner starts the `cleaning-up-after-a-task` skill. Never run it on
  your own, and never remove another worktree, another branch, or Docker data
  outside it.
- Preparation follows the `release-core` skill for notes, source review and
  tests. Publication uses its remote prepared image and official assets. It
  runs no source gate, image test, review or milestone work (record 0215).
  A pushed signed tag is never moved and never deleted.

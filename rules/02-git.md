# Git and GitHub

- Use conventional commits.
- Never force push.
- Do not use a bare `#N` in a GitHub comment or pull request body. Write
  `item 1`, `(2)`, or a plain list. Use `#NNNN` only for a real pull request or
  issue.
- Work happens in a git worktree on a short-lived branch.
- Before a branch lands, `pnpm verify` must pass.
- To land a branch, rebase it onto `main`, fast-forward merge it, then delete
  it. Pull requests are not required.
- Stay inside the active worktree. All edits, commits, and untracked files
  belong in that worktree.
- A release follows the `releasing-a-version` skill, from the changelog entry
  to the signed tag, the GitHub release, and the milestone. Prove each step
  with `node tools/release-check.mjs`. A pushed tag is never moved and never
  deleted.

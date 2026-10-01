---
name: cleaning-up-after-a-task
description: Cleans the development machine of the owner after a task. It removes the worktrees and the branches, removes the shared test database, deploys main to the local Docker deployment, and prunes the unused Docker data. Only the owner starts it, by name. An agent never runs it on its own, not at the end of a task and not as a step of another skill.
disable-model-invocation: true
---

# Cleaning up after a task

Run this skill only when the owner invokes it by name. It is the one
exception to the rule that an agent stays inside its worktree. The machine is
for development only, so take no backup.

## Steps

1. Stop the local application of each worktree.
2. Remove every worktree except the main checkout.
3. Delete every branch except `main`, on this machine and on `origin`.
4. Remove the shared test database of the Compose project `notesapp-test`
   with its volumes, when no worktree is left. The next test starts it again.
5. Deploy `main` to the local Docker deployment, and wait until it is ready.
6. Prune all unused Docker data, with the volumes.

## What stays

- Keep a branch that has an open pull request. Do not ask about it.
- Before you remove a worktree that holds work that is nowhere else, such as
  a change that is not committed or a `.env`, ask the owner.
- Before you delete a branch whose changes are not in `main`, ask the owner.

## Report

Start with the result. Then list the worktrees, the branches and the
containers that remain, the space that the prune reclaimed, and each item
that stayed and why.

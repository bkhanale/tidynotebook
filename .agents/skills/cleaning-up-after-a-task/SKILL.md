---
name: cleaning-up-after-a-task
description: Cleans the development machine of the owner after a task. It stops the local application of each worktree, removes the worktrees, deletes each branch on the machine and on origin that has no open pull request, removes the shared test database, deploys main to the local Docker deployment, and prunes every unused Docker image, network, build cache and anonymous volume. Only the owner starts it, by name. An agent never runs it on its own, not at the end of a task and not as a step of another skill.
disable-model-invocation: true
---

# Cleaning up after a task

Run this skill only when the owner invokes it by name. Never start it from a
plan, from another skill, or at the end of your own task. It removes every
worktree and branch of every agent, so only the owner decides when that
happens.

This skill is the one exception to the rule that an agent stays inside its
worktree. The machine is for development only, so the skill takes no backup.

## The checklist

Copy this into the answer and mark each step when it is done.

```
- [ ] 1. Read the plan
- [ ] 2. Ask about each item that loses work
- [ ] 3. Apply the plan
- [ ] 4. Report the result
```

### 1. Read the plan

Run this from any checkout of the repository:

```sh
node .agents/skills/cleaning-up-after-a-task/scripts/cleanup.mjs plan
```

It fetches `origin` and changes nothing else. Each line starts with a mark:

| Mark                                  | Meaning                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| `remove`, `delete`, `deploy`, `prune` | `apply` does it.                                            |
| `keep`                                | The item stays. The line states why.                        |
| `ask`                                 | The item holds work that exists nowhere else. It stays now. |
| `skip`                                | The step cannot run on this machine. The line states why.   |

The plan follows these rules:

- The main checkout and the `main` branch always stay.
- A worktree goes unless it has changes that are not committed, commits on a
  detached head that are not in `main`, or an ignored file that no build makes
  again, such as `.env`. Then it is `ask`. Installed packages, build output
  and `.local-app/` come back, so they do not count.
- A branch on the machine or on `origin` stays when it has an open pull
  request. A local branch also stays when a kept worktree uses it. Any other
  branch goes when every change is in `main`, and it is `ask` when it is not.
  A merge commit that is not in `main` counts as a change, unless a merge of
  the whole branch into `main` changes nothing.
- A branch is deleted only at the commit that the plan read. A branch that
  moved since then stays, and `apply` stops with the reason.
- The test database of the Compose project `notesapp-test` goes only when no
  worktree is left. `tools/test-database/ensure-postgres.sh` starts it again
  at the next integration test or local application.
- The deploy runs only when the main checkout is on a clean `main` and has a
  `.env`. It builds the local `main` and does not pull.
- The prune keeps each running container and what it uses. The data of the
  deployment is in host directories, so the prune does not touch it.

### 2. Ask about each item that loses work

When the plan has no `ask` line, go to step 3.

Otherwise, list each `ask` item with its reason, and ask the owner which ones
to remove. Remove nothing that the owner did not name.

### 3. Apply the plan

```sh
node .agents/skills/cleaning-up-after-a-task/scripts/cleanup.mjs apply
```

Add `--also <name>` once for each `ask` item that the owner named. The name is
the worktree path or the branch name exactly as the plan prints it, for
example `--also origin/feat/old-work`.

`apply` makes the plan again from the state of now, prints it, and runs the
steps in this order: stop the local applications, remove the worktrees,
delete the branches, remove the test database, deploy, prune. It stops at the
first step that fails and says that the later steps did not run. Fix the
cause and run `apply` again. A second run continues from where the first one
stopped.

### 4. Report the result

Start with the result. Then give the state that `apply` prints at its end:
the worktrees, the branches, the containers, and the reclaimed space. Name
each item that stayed and why. When `apply` says that the shell was in a
removed worktree, change to the main checkout.

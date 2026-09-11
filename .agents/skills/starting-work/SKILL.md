---
name: starting-work
description: Loads the repository context before any change. It runs tools/agent-context.mjs for the paths that the change touches, reads every guide, decision record and release row that the script lists, and restates the task against them. Use it before the first edit in this repository, at the start of a feature, a fix, a refactor, or a review.
---

# Starting work

Copy this checklist into the answer and mark each step when it is done.

- [ ] Name the paths that the change touches.
- [ ] Run `node tools/agent-context.mjs <paths>` with those paths.
- [ ] Read every file that the script prints, in the printed order.
- [ ] Write the restatement below.
- [ ] Make the first edit.

## The restatement

Write five lines, one for each point:

1. What changes, in one sentence.
2. Which directory guides apply, by path.
3. Which decision records apply, by path.
4. Which release list row the change closes.
5. How the change is verified.

## Feedback loop

- The script exits non-zero when it lists a file that is not there. A guide
  points at a moved file. Correct the pointer, run the script again, and read
  the new list. Do not start the change on a stale list.
- A restatement that conflicts with a rule in a guide or with a decision
  record is a stop. Ask the owner for a decision. Do not work around the rule.
- A path that has no directory guide still gets the core list. Read it.
- Read only the files that the script prints. They are the one level of
  reference for this step.

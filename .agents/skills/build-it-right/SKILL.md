---
name: build-it-right
description: Grounds a change in this repository before the first edit, then holds it to the engineering standard. It runs tools/agent-context.mjs for the paths the change touches, reads every AGENTS.md, decision record and guide that the script lists, and restates the task against them. It then states how to build, verify and report the work. Use it at the start of any feature, fix, refactor, migration or review here, and whenever an issue, a plan or a decision record has to be checked against the code.
---

# Build it right

A change is right when it rests on what the code does today, and when the gate
proves what the change claims. Ground it first, then build it to the standard.

## a. Ground the change

Copy this checklist into the answer and mark each step when it is done.

```
- [ ] Name the paths that the change touches.
- [ ] Run node tools/agent-context.mjs <paths> with those paths.
- [ ] Read every file that the script prints, in the printed order.
- [ ] Write the restatement.
- [ ] Make the first edit.
```

### The restatement

Write five lines, one for each point:

1. What changes, in one sentence.
2. Which directory guides apply, by path.
3. Which decision records apply, by path.
4. Which board row the change closes.
5. How the change is verified.

### The code is the final authority

An issue, a plan, a design and a decision record each state what somebody
believed when they wrote it. Read the code before you act on any of them.

- Open every file and line that a brief names. A path moves, a line number
  drifts, and a dependency that a plan waits for often already landed.
- When a document and the code disagree, the code is what is true. Say so with
  the file and the line, and state what you did instead.
- A decision record is a decision, not a court order. When a record is wrong,
  report the argument and stop. Do not force it, and do not ignore it in
  silence.
- A restatement that conflicts with a rule or a record is a stop. Ask the
  owner. Do not work around the rule.

Example. A plan says an item waits on another row. That row closed a week ago,
so the item ships now. Say that in the report, and name the commit that closed
it.

### The feedback loop of the script

The script exits non-zero when it lists a file that is not there, which means a
guide points at a moved file. Correct the pointer, run the script again, and
read the new list. Do not start on a stale list. A path with no directory guide
still gets the core list, so read it.

## b. Build it to the standard

- **No hack.** When a thing cannot be solved cleanly, stop on it. Report the
  file, the line, the reason, and what a clean fix needs. A named problem is
  worth more than a hidden one.
- **Make the invariant hold by construction.** A rule that one caller can
  forget is a defect that waits. Example: two checks answered "is this origin
  ours" from two sources and disagreed, so one list now answers it and both
  checks read that list.
- **One source for one fact.** Two lists of one rule drift. Find the second
  copy before you add the first.
- **Follow the order of the feature workflow.** The contract, the domain rule,
  the storage, the handler, the client, then the verification. Put the code
  where decision record 0018 says.
- **Widen a stage only on purpose.** When the stated scope cannot land alone,
  say so, say why, and say what you widened. Do not quietly do more or less.
- **An architectural choice gets a record before the code.** A choice is
  architectural when it moves a boundary, adds or removes a package, changes
  the save model, adds a second parser or renderer, changes the contract emit
  rules, changes the migration policy, or changes what the gate proves.

## c. Verify what you claim

- **Test at each level that applies.** A unit test beside the module for the
  pure rule, and an integration test against the real service for the served
  result. What a person sees is proved by the module that decides it. State
  which levels you added, and why you skipped one.
- **Prove the test fails before the fix.** Restore the old behaviour, run the
  test, read the failure, then put the fix back. A regression test that never
  failed proves nothing. Say in the report that you confirmed it.
- **A green check is not a working change.** Example: a focus rule passed the
  type check, the lint and the unit tests, and the browser ignored it, because
  the attribute only acts while a document parses. When a change reaches a
  person, drive the real thing and read the result.
- **Check the check.** A gate can pass for the wrong reason. Example: a lint
  rule for unused components became a no-op when the source split into files,
  because the root reference counted as a use. When a check passes, know why.
- **Never weaken the gate.** Do not weaken an assertion, do not add a fixed
  delay, do not raise a timeout, and do not skip a failing test.
- Run `pnpm verify` before the change is ready. It is the whole gate. No
  browser test exists, so take a screenshot of each screen that the change
  touches in light and in dark, and read it against the design guide.

## d. Report it honestly

- Start with the result, then give the evidence.
- Name what you did not do, and why. A gap that is written down is part of the
  work. A gap that is not is a fault.
- Report anything that looks like a defect with its file and its line. Fix it
  when it is inside the change, and record it when it is not.
- Commit at each clean boundary, so an interruption costs one step. Use
  conventional commits. Never force push.

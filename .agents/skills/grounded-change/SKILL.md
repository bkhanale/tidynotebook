---
name: grounded-change
description: Grounds a change in the real state of this repository, then holds it to the engineering standard. It runs tools/agent-context.mjs for the paths the change touches, reads every guide and decision record the script lists, restates the task against them, and states the rules for building, verifying and reporting the work. Use it before the first edit of any feature, fix, refactor or review.
---

# A grounded change

A change is grounded when it rests on what the code does today, not on what a
document, an issue, or a brief says it does. Ground the change first, then
build it to the standard below.

## a. Ground the change

- [ ] Name the paths that the change touches.
- [ ] Run `node tools/agent-context.mjs <paths>` with those paths.
- [ ] Read every file that the script prints, in the printed order.
- [ ] Write the restatement.
- [ ] Make the first edit.

### The restatement

Write five lines, one for each point:

1. What changes, in one sentence.
2. Which directory guides apply, by path.
3. Which decision records apply, by path.
4. Which board row the change closes.
5. How the change is verified.

### The code is the final authority

An issue, a plan, a design, and a decision record each state what somebody
believed when they wrote it. Read the code before you act on any of them.

- Open every file and line that a brief names. A path moves, a line number
  drifts, and a dependency that a plan is waiting for often already landed.
- When a document and the code disagree, the code is what is true. Say so
  plainly, with the file and the line, and state what you did instead.
- A decision record is a decision, not a court order. When a record is wrong,
  or names a rule that cannot hold, report the argument and stop. Do not force
  it, and do not ignore it in silence.
- A restatement that conflicts with a rule or with a record is a stop. Ask the
  owner. Do not work around the rule.

### The feedback loop of the script

- The script exits non-zero when it lists a file that is not there. A guide
  points at a moved file. Correct the pointer, run the script again, and read
  the new list. Do not start the change on a stale list.
- A path that has no directory guide still gets the core list. Read it.

## b. Build it to the standard

- **No hack.** When a thing cannot be solved cleanly, stop on it. Report the
  file, the line, the reason, and what a clean fix needs. An unsolved problem
  that is named is worth more than a solved problem that is hidden.
- **Make the invariant hold by construction.** A rule that one caller can
  forget is a defect that waits. Put the bound where no caller can reach past
  it: one list that every check reads, the scope inside the query, a frozen
  value returned by identity, a type the compiler refuses.
- **One source for one fact.** Two lists of one rule drift. Two answers to one
  question disagree. Find the second copy before you add the first.
- **Put the code where record 0018 says.** Follow the order of
  `docs/development/feature-workflow.md`: the contract, the domain rule, the
  storage, the handler, the client, then the verification.
- **Widen a stage only on purpose.** When the stated scope cannot land alone,
  say so, say why, and say what you widened. Do not quietly do more, and do
  not quietly do less.
- **An architectural choice gets a record before the code.** A choice is
  architectural when it moves a boundary, adds or removes a package, changes
  the save model, adds a second parser or renderer, changes the contract emit
  rules, changes the migration policy, or changes what the gate proves.

## c. Verify what you claim

- **Test at each level that applies.** A unit test beside the module, an
  integration test against the real service, a browser journey for what a
  person sees. State which levels you added, and why you skipped one.
- **Prove the test fails before the fix.** Restore the old behaviour, run the
  test, and read the failure. A regression test that never failed proves
  nothing. Say in the report that you confirmed it.
- **A green check is not a working change.** A type check, a lint rule and a
  unit test all pass on behaviour that a browser refuses. When the change
  reaches a person, drive the real thing and read the result.
- **Check the check.** A gate can pass for the wrong reason: a rule that the
  layout turned into a no-op, a name that every row shares, a cap that nothing
  reads. When a check passes, know why.
- **Never weaken the gate.** Do not weaken an assertion, do not add a fixed
  delay, do not raise a timeout, and do not skip a failing test. A flaky test
  that a bigger number fixes is not fixed.
- Run `pnpm verify` before the change is ready. Run the browser matrix when
  navigation, persistence, keyboard behaviour, or editor rendering changes.

## d. Report it honestly

- Start with the result, then give the evidence.
- Name what you did not do, and why. A known gap that is written down is part
  of the work; a known gap that is not is a fault.
- Report anything that looks like a defect with its file and its line. Fix it
  when it is inside the change, and record it when it is not.
- Commit at each clean boundary, so an interruption costs one step. Use
  conventional commits. Never force push.

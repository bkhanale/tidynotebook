# 0154. A change carries its test

- Status: Accepted
- Date: 2026-10-02

## Context

`AGENTS.md` asks for a regression test for each fixed defect, and the review is
the only thing that holds it. The owner asked that the test of a change become
part of the change without a prompt. [Design 020](../design/020-a-documentation-site.md)
compares a rule, a Git hook, a check in the gate and a hook of the agent.

## Decision

- `tools/check-change-tests.mjs` compares the branch with `main`, including
  the files that are not committed yet. A change to the source of a
  workspace package, or to a tool under `tools/`, needs a change to a test of
  that package or of `tests/integration/` in the same branch.
- A source file is a `.ts`, `.tsx`, `.mjs` or `.js` file that is not a test, a
  declaration, generated output or build output. A `.tsx` file counts,
  because its logic belongs in a `.ts` module with a test (record 0066).
- A commit of the branch can carry the trailer `Test-exempt: <area> <reason>`,
  where the area is the package directory, for example `apps/web`. The check
  then prints the reason and passes that area. A reason is required.
- `pnpm lint` runs the check, so `pnpm verify` refuses a branch that fails it.
- `.claude/settings.json` runs the same check as a Stop hook. When an agent
  ends its turn with source changes and no test, the hook sends it back with
  the names of the areas. The hook gives way on the second stop of one turn,
  so it never traps an agent, and the gate still holds.
- On `main` itself, and where `main` cannot be found, the check has nothing to
  compare and passes with a notice.

## Consequences

- A change with no test fails before it lands, and the reason for an exempt
  change is in the history.
- The check proves that a test changed, not that the test is good. The review
  and the rule of a failing test before the fix still hold that.
- `tools/check-change-tests.test.mjs` proves the rule, the trailer and each
  refusal.

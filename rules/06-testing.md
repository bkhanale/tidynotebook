# Verification

- Add a regression test for each fixed defect.
- Prove what a person sees through the pure module that decides it and through
  an integration test of the served result.
- Take a screenshot of each changed screen in light and in dark before a
  landing.
- To run the application of a worktree and drive it in a browser, follow the
  `testing-changes-end-to-end` skill. Each worktree runs its own application,
  so worktrees do not conflict.
- Run focused tests while work is in progress. Run `pnpm verify` before a
  change is ready to merge.
- Do not weaken assertions, add fixed delays, or skip a failing test to make a
  suite pass.

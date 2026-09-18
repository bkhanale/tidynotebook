# Verification

- Add a regression test for each fixed defect.
- Prove what a person sees through the pure module that decides it and through
  an integration test of the served result.
- Take a screenshot of each changed screen in light and in dark before a
  landing.
- Run focused tests while work is in progress. Run `pnpm verify` before a
  change is ready to merge.
- Do not weaken assertions, add fixed delays, or skip a failing test to make a
  suite pass.

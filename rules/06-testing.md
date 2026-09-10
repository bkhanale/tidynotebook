# Verification

- Add a regression test for each fixed defect.
- Cover every P0 user journey with a browser test that uses the public
  interface and checks the server result.
- A first-user test must start with an empty database and must use the real
  setup screen. Do not create its account through a test-only bootstrap route.
- Run focused tests while work is in progress. Run `pnpm verify` before a
  change is ready to merge.
- Run the browser matrix when navigation, persistence, keyboard behavior, or
  editor rendering changes.
- Do not weaken assertions, add fixed delays, or skip a failing test to make a
  suite pass.

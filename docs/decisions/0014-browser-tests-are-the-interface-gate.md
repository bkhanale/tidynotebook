# 0014. Browser tests are the interface gate

- Status: Superseded by [0066](0066-the-browser-suite-is-retired.md)
- Date: 2026-09-10

## Context

A DOM unit framework tests a component against a simulated browser. It adds a
large dependency, and it still does not prove that a journey works in a real
browser.

## Decision

No DOM unit framework is added. Component logic that needs a unit test is
extracted into a pure module, as `apps/web/src/features/save-state.ts` and
`note-name.ts` already are. The Playwright matrix is the gate for the user
interface and runs on every push to `main`.

## Consequences

- A `.tsx` file holds rendering and wiring. Testable logic moves to a `.ts`
  file next to it with its own `.test.ts`.
- Every P0 journey has a browser test that uses the public interface and
  checks the server result.
- `pnpm test:unit` stays fast, because it runs Node only.

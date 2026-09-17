# 0054. Motion is a named scale in one module

- Status: Accepted
- Date: 2026-09-17

## Context

Colour transitions appear across the shell with no stated duration and no
stated easing, so each one takes a framework default. A button also scaled
down on press, which is a touch idiom and reads wrong under a mouse. Tailwind
gives a duration no theme namespace, so a duration written in a class is a bare
number that no rule can hold.
See [design 011](../design/011-depth-and-hierarchy.md).

## Decision

`packages/ui/src/motion.ts` states the motion of the application as named class
strings, the way `pageGutter` in `packages/ui/src/layout.tsx` states the one
distance from the edge of the screen to the content. Every animated thing reads
a name from that module, and the module is the only place that names a
duration or an easing.

`tools/check-design-rules.mjs` refuses a duration utility, an easing utility
and a transition utility in `apps/web/src` and `packages/ui/src`, and allows
`packages/ui/src/motion.ts` alone.

Every named transition is wrapped for reduced motion, so the preference of the
person is held by the scale and not by each caller.

## Consequences

- A screen cannot invent a duration, and the reduced motion rule cannot be
  forgotten by one caller.
- The easing values live in the central theme of `apps/web/src/tailwind.css`,
  because Tailwind gives easing a theme namespace and a duration none.
- `packages/ui/src/motion.test.ts` holds the shape of each name.
- A one off animation now needs a new name in the module and a reason for it.

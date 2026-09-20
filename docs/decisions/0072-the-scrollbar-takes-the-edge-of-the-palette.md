# 0072. The scrollbar takes the edge of the palette

- Status: Accepted
- Date: 2026-09-20

## Context

[Record 0071](0071-the-page-states-its-appearance-to-the-browser.md) states the
appearance of the page to the browser, so a dark palette no longer carries the
light scrollbar of a light page. The browser still chooses the bar itself, and
its dark choice is a grey thumb in a grey track. On the note surface that bar
stands beside one column of text and reads louder than the text, and it holds
no relation to the palette that the person picked.

## Decision

The palette states the scrollbar of every region that scrolls. `applyTheme` in
`packages/ui/src/theme.ts` writes `scrollbar-color` beside the colour scheme,
and the first paint script of `apps/web/index.html` writes the same value.

The thumb is `border`, the component edge of the palette, because a scrollbar
is a control that a person must see and grab, and `theme.test.ts` already holds
that token to the non-text minimum on every surface. The track is nothing, so
the page shows through and a region that scrolls gains no second edge.

The value names the palette property instead of copying a colour, so one write
follows every theme change and the registry stays the one place with a colour.

## Consequences

- One rule covers the note, the sidebar, the outline, every menu and every
  dialog. No surface states a scrollbar of its own.
- A browser that does not support the property keeps the bar of record 0071,
  which follows the appearance and is already correct.
- The bar is quieter than a platform bar, which is the intent. A person who
  needs a wider target uses the system setting of their device, which the
  property does not change.

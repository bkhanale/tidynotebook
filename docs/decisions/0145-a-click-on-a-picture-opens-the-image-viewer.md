# 0145. A click on a picture opens the image viewer

- Status: Accepted
- Date: 2026-10-01

## Context

The image widget in `packages/editor/src/widgets.ts` draws a picture at the
width of the note column, and a click on it puts the caret at its source. A
person cannot see a large picture at its own size, cannot zoom it, and cannot
save or copy it. The owner reported this gap on 2026-10-01.

The page refuses a `fetch` of a blob address and of another host
(`connect-src` in `apps/server/src/plugins/security-headers.ts`), and a canvas
that draws a picture of another host without CORS cannot give its bytes back.

## Decision

A picture of the note is a button inside its widget. A click, or Enter on it
after Tab, opens the image viewer of
`apps/web/src/features/editor/image-viewer.tsx`. The editor asks for it
through the `onOpenImage` resolver, so the editor still renders no control of
`packages/ui`. The widget kinds of record 0002 do not change.

A click on the widget beside the picture puts the caret at its source, as
before. An arrow key still opens the source as record 0002 states.

The viewer is one `Dialog` of `packages/ui` at the `screen` width: the
picture stands on a deeper scrim with no panel, and one raised bar of tools
floats over it. A tap on the scrim beside the picture closes it, as Escape
and Close do. The viewer fits the picture to the screen, and it zooms with
its buttons, with the `+`, `-` and `0` keys, and with Ctrl or Cmd and the
wheel. `apps/web/src/lib/image-viewer.ts` holds the zoom steps, the fit, the
tap rule, the actions and the download name.

- A picture of the workspace offers Copy image and Download. Download saves
  the bytes of the blob address. Copy draws the picture into a canvas and
  writes one PNG to the clipboard, the one image type that every browser
  accepts there.
- A picture of another host offers Copy link and Open original, because the
  page cannot read its bytes. The original opens in a new tab with no
  referrer, as record 0067 states for the picture itself.

## Consequences

- A click on a picture no longer opens its source. A click beside it, or an
  arrow key, does.
- Tab from the note text reaches each picture before it leaves the editor.
- The published page keeps its plain picture. It runs no script of the
  application (record 0031).
- `packages/editor/src/widgets.test.ts` and
  `apps/web/src/lib/image-viewer.test.ts` hold the rule.

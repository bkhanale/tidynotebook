# Third party licenses of `@notesapp/ui`

Every borrowed theme in `src/themes/` copies colour values from the published
palette of an upstream project. The copyright and the license of those values
belong to the upstream author. This file names the project, the license, and
the address of each palette, and it records which values notesapp derives. Ink
is the one exception: it is the signature family of this application, so it
carries no upstream author and its values are original.

## How a palette becomes a theme

Three groups of values are derived inside each palette, because a published
palette is made for a text editor and this application paints five surfaces:

- **Surface steps.** The page background and the sidebar surface are
  published values. The card, the row hover, and the row active fills mix a
  measured amount of the body text colour into the background, so no surface
  of a theme drifts far enough from its background to fail a small text
  token on it.
- **Text and edge tokens.** A token that does not reach WCAG 2.2 AA on every
  surface it renders on is moved along its own lightness until it does. The
  hue of the published value is kept, so the theme still reads as itself.
  `border` and `focus` are held to the 3 to 1 non text minimum, and a label
  on a control fill to 4.5 to 1.
- **Code colours.** Every value of the `syntax` group is held to 4.5 to 1 on
  the page background and on the code block fill.

`src/theme.test.ts` checks all of this for every theme in the registry, so a
theme that fails a rule cannot ship.

## Ink

- Signature family of this application. No upstream palette.
- License: MIT ([this repository](https://github.com/bkhanale/notesapp))
- Original: every value of both variants. The warm graphite dark and the warm
  paper light carry one brass accent, and every token meets the contrast rules
  in `src/theme.ts` that `src/theme.test.ts` proves.

## Tokyo Night

- Upstream: [Tokyo Night by Folke Lemaitre](https://github.com/folke/tokyonight.nvim)
- License: Apache License 2.0 ([full text](https://github.com/folke/tokyonight.nvim/blob/main/LICENSE))
- Used files: Night palette (`extras/lua/tokyonight_night.lua`) and Day
  palette (`extras/lua/tokyonight_day.lua`)
- Derived: the interface tokens of both variants, as the first release of
  this application recorded them; eight code colours of Day and the comment
  colour of Night.

## Catppuccin

- Upstream: [Catppuccin](https://github.com/catppuccin/catppuccin)
- License: MIT
- Used files: the published Latte and Mocha palettes
- Derived in Latte: muted text, accent, success, danger, the component edge,
  and the code colours. Derived in Mocha: nothing beyond the surface steps.

## Dracula

- Upstream: [Dracula](https://github.com/dracula/dracula-theme)
- License: MIT
- Used files: the published Dracula palette
- Derived: muted text and the component edge, which both start from the
  comment colour, plus the accent, the danger text, and the code comment.
  Dracula publishes one dark palette, so the family answers a light
  appearance with it.

## GitHub

- Upstream: [GitHub Primer primitives](https://github.com/primer/primitives)
- License: MIT
- Used files: the published light and dark primitives
- Derived: the component edge of both variants, which is decorative
  upstream, plus the accent and danger text and, in Light, muted text,
  success text, and the code comment.

## Gruvbox

- Upstream: [Gruvbox by Pavel Pertsev](https://github.com/morhetz/gruvbox)
- License: MIT
- Used files: the published light and dark palettes
- Derived: the component edge and success text of Light, the accent and
  danger text of Dark, the scrim of Dark, and several code colours of both.

## Nord

- Upstream: [Nord by Arctic Ice Studio and Sven Greb](https://github.com/nordtheme/nord)
- License: MIT
- Used files: the published Nord palette (`nord0` to `nord15`)
- Derived: the sidebar surface, muted text, the component edge, the danger
  text, and four code colours. Nord publishes one dark palette. The
  published Snow Storm inversion does not reach AA on this surface set, so
  the family ships dark only and answers a light appearance with it.

## One

- Upstream: [Atom One by GitHub](https://github.com/atom/atom/tree/master/packages/one-dark-syntax)
- License: MIT
- Used files: the published One Light and One Dark syntax and interface
  colours
- Derived: muted text and the component edge of both variants, which start
  from the comment grey, the control fills of One Light, and the code
  colours that the light background needed.

## Rosé Pine

- Upstream: [Rosé Pine](https://github.com/rose-pine/rose-pine-theme)
- License: MIT
- Used files: the published Dawn and Moon palettes
- Derived: muted text, the component edge, and the danger text of both
  variants, the accent and the focus ring of Dawn, and the code colours that
  the light background needed. Rosé Pine publishes no green, so success text
  uses `pine` in Dawn and `foam` in Moon.

## Solarized

- Upstream: [Solarized by Ethan Schoonover](https://github.com/altercation/solarized)
- License: MIT
- Used files: the published sixteen colour palette
- Derived: the most of any family. Solarized sets its accent colours for a
  low contrast reading surface, so body text, muted text, the accent, the
  success and danger text, the component edge, and every code colour move to
  reach AA on both variants.

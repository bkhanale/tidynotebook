# Third party licenses of `@notesapp/ui`

## Tokyo Night

- Upstream: [Tokyo Night by Folke Lemaitre](https://github.com/folke/tokyonight.nvim)
- License: Apache License 2.0 ([full text](https://github.com/folke/tokyonight.nvim/blob/main/LICENSE))
- Used files: Night palette (`extras/lua/tokyonight_night.lua`) and Day palette
  (`extras/lua/tokyonight_day.lua`)

The palette values per mode in `src/theme.ts` (background, sidebar surface,
card, hover, active, main text, and the Night blue, green, and red) are copied
from that project. The copyright and license belong to the upstream author.
Every other token, including the Day accent, success, and danger values and
all border, focus, fill, and scrim tokens, is derived by notesapp inside the
palette so that each rendered pair meets WCAG 2.2 AA contrast. The derivation
is checked by `src/theme.test.ts`.

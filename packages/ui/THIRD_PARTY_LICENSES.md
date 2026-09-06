# Third party licenses of `@notesapp/ui`

## Tokyo Night

- Upstream: [Tokyo Night by Folke Lemaitre](https://github.com/folke/tokyonight.nvim)
- License: Apache License 2.0 ([full text](https://github.com/folke/tokyonight.nvim/blob/main/LICENSE))
- Used files: Night palette (`extras/lua/tokyonight_night.lua`) and Day palette
  (`extras/lua/tokyonight_day.lua`)

The six palette values per mode in `src/tokens.css` and `src/theme.ts`
(background, sidebar surface, main text, accent blue, green, red) are copied
from that project. The copyright and license belong to the upstream author.
Semantic text, fill, border, and focus variants are derived by notesapp within
the palette so that text meets WCAG 2.2 AA contrast.

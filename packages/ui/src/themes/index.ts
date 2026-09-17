/**
 * The theme registry.
 *
 * Every colour of the application comes from this registry: the Tailwind
 * runtime variables, the CodeMirror adapter, the diagram frame, the browser
 * interface colour, and the script that paints before React starts. A new
 * theme is therefore one new data file next to this one plus one line in
 * `themeFamilies` below, and no component changes.
 *
 * `theme.test.ts` walks the whole registry, so a new family is held to the
 * same contrast rules as the families that ship today.
 *
 * This module is also the entry point that `@notesapp/ui/themes` publishes:
 * it re-exports the theme contract, so a consumer that must not load React,
 * such as the build step and the sandboxed diagram frame, reads the palette
 * from here.
 */
import type { Appearance, Theme, ThemeFamily } from '../theme.ts';

export type {
  Appearance,
  AppearanceChoice,
  DerivedPropertyName,
  SyntaxPropertyName,
  SyntaxTokens,
  Theme,
  ThemeFamily,
  ThemePropertyName,
  ThemeRoot,
  ThemeSource,
  ThemeTokens,
} from '../theme.ts';
export {
  appearanceStorageKey,
  applyTheme,
  applyThemeToDocument,
  contrastRatio,
  derivedPropertyName,
  derivedPropertyNames,
  derivedValue,
  dividerBlend,
  mixHexColors,
  parseAppearanceChoice,
  parseHexColor,
  relativeLuminance,
  resolveAppearance,
  syntaxPropertyName,
  syntaxPropertyNames,
  textContrastMinimum,
  themeFamilyStorageKey,
  themeProperties,
  themePropertyName,
  themePropertyNames,
  uiContrastMinimum,
} from '../theme.ts';
import { catppuccin } from './catppuccin.ts';
import { dracula } from './dracula.ts';
import { github } from './github.ts';
import { gruvbox } from './gruvbox.ts';
import { ink } from './ink.ts';
import { nord } from './nord.ts';
import { one } from './one.ts';
import { rosePine } from './rose-pine.ts';
import { solarized } from './solarized.ts';
import { tokyoNight } from './tokyo-night.ts';

/** Every family, in the order the settings screen offers them. */
export const themeFamilies: readonly ThemeFamily[] = [
  ink,
  tokyoNight,
  catppuccin,
  dracula,
  github,
  gruvbox,
  nord,
  one,
  rosePine,
  solarized,
];

/** Every variant of every family, flattened. */
export const themes: readonly Theme[] = themeFamilies.flatMap(
  (family) => family.variants,
);

/** The family a new installation starts with. */
export const defaultThemeFamilyId = 'ink';

/** The family of one identifier, or `null` when nothing matches. */
export function findThemeFamily(id: string): ThemeFamily | null {
  return themeFamilies.find((family) => family.id === id) ?? null;
}

/** The variant of one identifier, or `null` when nothing matches. */
export function findTheme(id: string): Theme | null {
  return themes.find((theme) => theme.id === id) ?? null;
}

/**
 * The variant of one family for one appearance.
 *
 * A family that publishes only a dark palette answers a light appearance
 * with that dark palette, because the family is the choice the person made
 * and a missing variant must never leave the page without colour.
 */
export function themeOfFamily(
  family: ThemeFamily,
  appearance: Appearance,
): Theme {
  const match = family.variants.find(
    (theme) => theme.appearance === appearance,
  );
  const fallback = family.variants[0];
  if (fallback === undefined)
    throw new Error(`The theme family ${family.id} has no variant.`);
  return match ?? fallback;
}

/** The default family variant for one appearance. */
export function defaultThemeFor(appearance: Appearance): Theme {
  const family = findThemeFamily(defaultThemeFamilyId);
  if (family === null)
    throw new Error('The default theme family is not registered.');
  return themeOfFamily(family, appearance);
}

/**
 * The theme to render for a stored family identifier and an appearance.
 *
 * An unknown family falls back to the default family, so a stored value
 * from another installation or a removed theme still renders.
 */
export function themeFor(familyId: string, appearance: Appearance): Theme {
  const family = findThemeFamily(familyId);
  if (family === null) return defaultThemeFor(appearance);
  return themeOfFamily(family, appearance);
}

/**
 * Reads a family identifier from an untrusted stored value.
 *
 * Anything that is not a registered family falls back to the default.
 */
export function parseThemeFamilyId(value: unknown): string {
  if (typeof value === 'string' && findThemeFamily(value) !== null)
    return value;
  return defaultThemeFamilyId;
}

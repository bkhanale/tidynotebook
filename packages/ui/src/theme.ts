/**
 * The theme contract: token names, the theme record, and contrast helpers.
 *
 * A theme is data. This module owns the shape of that data and the rules
 * every theme must meet; the palettes themselves live one per family in
 * `src/themes/`. Nothing outside that folder holds a colour value, so a new
 * theme is one new data file and one line in the registry index.
 *
 * Contrast rules that `theme.test.ts` enforces per surface, for every theme
 * in the registry:
 *
 * - `text` is the body colour of the main background and the card surface
 *   only. On the sidebar surface, and on the hover and active states, a
 *   container sets `textStrong` or `textMuted`, which pass on all five
 *   surfaces. No screen lets `text` inherit onto a sidebar row.
 * - `textStrong`, `textMuted`, `accentText`, `successText`, and `dangerText`
 *   meet 4.5 to 1 on every surface of the palette.
 * - `border` and `focus` meet the 3 to 1 non-text minimum on every surface,
 *   so a component edge uses `border`. `borderSubtle` is decorative only: it
 *   separates regions that already differ in fill and never identifies a
 *   control.
 * - A control fill carries its own label token: `accentOnFill` on
 *   `accentFill`, and `onDanger` on `dangerFill`.
 * - Every syntax colour meets 4.5 to 1 on the page background and on the
 *   code block fill, which is the hover surface.
 *
 * `applyTheme` writes the values as custom properties for the central
 * Tailwind theme and for the typed CodeMirror adapter.
 */

/** The stored appearance choice of an account. Matches the API type. */
export type AppearanceChoice = 'system' | 'light' | 'dark';

/** The appearance that is actually rendered. */
export type Appearance = 'light' | 'dark';

/** The local settings key of the appearance choice. */
export const appearanceStorageKey = 'notesapp.theme';

/** The local settings key of the theme family. */
export const themeFamilyStorageKey = 'notesapp.theme-family';

/**
 * Selects the appearance for a stored choice and the device preference.
 *
 * `system` follows the device: dark when `prefersDark` is true, light
 * otherwise. An explicit choice always wins over the device preference.
 */
export function resolveAppearance(
  choice: AppearanceChoice,
  prefersDark: boolean,
): Appearance {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

/**
 * Reads an appearance choice from an untrusted stored value.
 *
 * Anything that is not one of the three known choices falls back to
 * `system`, so a corrupt setting cannot break rendering.
 */
export function parseAppearanceChoice(value: unknown): AppearanceChoice {
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return 'system';
}

/**
 * Every colour that the application shell needs, for one theme.
 *
 * `text` is the body colour of the main background and the card surface.
 * `textStrong` and `textMuted` pass on every surface, so a sidebar row, a
 * hover state, and an active state always use one of those two. `accentText`,
 * `successText`, and `dangerText` are the small text variants. `accentFill`
 * and `dangerFill` are control fills whose labels use `accentOnFill` and
 * `onDanger`. `scrim` is the fill behind a dialog; a page applies it with an
 * opacity utility.
 */
export type ThemeTokens = {
  readonly background: string;
  readonly surface: string;
  readonly surfaceCard: string;
  readonly surfaceHover: string;
  readonly surfaceActive: string;
  readonly text: string;
  readonly textStrong: string;
  readonly textMuted: string;
  readonly accentText: string;
  readonly accentFill: string;
  readonly accentOnFill: string;
  readonly successText: string;
  readonly dangerText: string;
  readonly dangerFill: string;
  readonly onDanger: string;
  readonly border: string;
  readonly borderSubtle: string;
  readonly focus: string;
  readonly scrim: string;
};

/**
 * The colours of code inside a fenced block.
 *
 * The live preview styles Markdown itself, so this group covers only the
 * highlighted code of a fence. The editor adapter reads these through their
 * custom properties, which is why a theme change needs no editor rebuild.
 */
export type SyntaxTokens = {
  readonly keyword: string;
  readonly string: string;
  readonly comment: string;
  readonly number: string;
  readonly tag: string;
  readonly attribute: string;
  readonly heading: string;
  readonly link: string;
  readonly punctuation: string;
};

/** Where a palette comes from, for the attribution file and the settings. */
export type ThemeSource = {
  /** The upstream project name. */
  readonly project: string;
  /** The upstream address of the published palette. */
  readonly url: string;
  /** The upstream licence, for example `MIT`. */
  readonly licence: string;
};

/** One rendered palette: a light or a dark variant of one family. */
export type Theme = {
  /** Stable identifier, for example `tokyo-night-day`. */
  readonly id: string;
  /** The family this variant belongs to, for example `tokyo-night`. */
  readonly family: string;
  /** The name a person reads, for example `Tokyo Night Day`. */
  readonly name: string;
  /** Which device preference this variant answers. */
  readonly appearance: Appearance;
  readonly source: ThemeSource;
  readonly tokens: ThemeTokens;
  readonly syntax: SyntaxTokens;
};

/** One named family with its light and dark variants. */
export type ThemeFamily = {
  /** Stable identifier, for example `tokyo-night`. */
  readonly id: string;
  /** The name a person reads, for example `Tokyo Night`. */
  readonly name: string;
  readonly source: ThemeSource;
  /** One or two variants. A family with one variant uses it for both. */
  readonly variants: readonly Theme[];
};

/** Minimum WCAG contrast for normal text. */
export const textContrastMinimum = 4.5;

/** Minimum WCAG contrast for controls, borders, and focus indicators. */
export const uiContrastMinimum = 3;

/**
 * Parses a six digit hex colour such as `#1a1b26`.
 *
 * Returns the red, green, and blue channels on a 0 to 1 scale, or `null`
 * when the input is not a six digit hex colour.
 */
export function parseHexColor(
  hex: string,
): readonly [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  return [red, green, blue];
}

/** Linearizes one sRGB channel for a luminance calculation. */
function linearize(channel: number): number {
  if (channel <= 0.03928) return channel / 12.92;
  return ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Computes the WCAG relative luminance of a hex colour.
 *
 * Returns `NaN` when the input is not a six digit hex colour.
 */
export function relativeLuminance(hex: string): number {
  const channels = parseHexColor(hex);
  if (channels === null) return NaN;
  const [red, green, blue] = channels;
  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

/**
 * Computes the WCAG contrast ratio of two hex colours, from 1 to 21.
 *
 * Returns `NaN` when either input is not a six digit hex colour.
 */
export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  if (Number.isNaN(firstLuminance) || Number.isNaN(secondLuminance)) return NaN;
  const lower = Math.min(firstLuminance, secondLuminance);
  const upper = Math.max(firstLuminance, secondLuminance);
  return (upper + 0.05) / (lower + 0.05);
}

/** The token names that `applyTheme` writes, in a fixed order. */
export const themePropertyNames = [
  'background',
  'surface',
  'surfaceCard',
  'surfaceHover',
  'surfaceActive',
  'text',
  'textStrong',
  'textMuted',
  'accentText',
  'accentFill',
  'accentOnFill',
  'successText',
  'dangerText',
  'dangerFill',
  'onDanger',
  'border',
  'borderSubtle',
  'focus',
  'scrim',
] as const;

/** One of the token names of {@link themePropertyNames}. */
export type ThemePropertyName = (typeof themePropertyNames)[number];

/** The syntax token names that `applyTheme` writes, in a fixed order. */
export const syntaxPropertyNames = [
  'keyword',
  'string',
  'comment',
  'number',
  'tag',
  'attribute',
  'heading',
  'link',
  'punctuation',
] as const;

/** One of the syntax token names of {@link syntaxPropertyNames}. */
export type SyntaxPropertyName = (typeof syntaxPropertyNames)[number];

/**
 * Maps token names to stylesheet custom property names.
 *
 * For example `background` becomes `--notes-bg`.
 */
export function themePropertyName(name: ThemePropertyName): string {
  if (name === 'background') return '--notes-bg';
  if (name === 'surface') return '--notes-surface';
  if (name === 'surfaceCard') return '--notes-surface-card';
  if (name === 'surfaceHover') return '--notes-surface-hover';
  if (name === 'surfaceActive') return '--notes-surface-active';
  if (name === 'textStrong') return '--notes-text-strong';
  if (name === 'textMuted') return '--notes-text-muted';
  if (name === 'accentText') return '--notes-accent-text';
  if (name === 'accentFill') return '--notes-accent-fill';
  if (name === 'accentOnFill') return '--notes-accent-on-fill';
  if (name === 'successText') return '--notes-success-text';
  if (name === 'dangerText') return '--notes-danger-text';
  if (name === 'dangerFill') return '--notes-danger-fill';
  if (name === 'onDanger') return '--notes-on-danger';
  if (name === 'text') return '--notes-text';
  if (name === 'border') return '--notes-border';
  if (name === 'borderSubtle') return '--notes-border-subtle';
  if (name === 'scrim') return '--notes-scrim';
  return '--notes-focus';
}

/**
 * Maps syntax token names to stylesheet custom property names.
 *
 * For example `keyword` becomes `--notes-syntax-keyword`.
 */
export function syntaxPropertyName(name: SyntaxPropertyName): string {
  return `--notes-syntax-${name}`;
}

/** Every custom property of one theme, as name and value pairs. */
export function themeProperties(
  theme: Theme,
): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (const name of themePropertyNames)
    pairs.push([themePropertyName(name), theme.tokens[name]]);
  for (const name of syntaxPropertyNames)
    pairs.push([syntaxPropertyName(name), theme.syntax[name]]);
  return pairs;
}

/** The smallest surface that `applyTheme` can write to, for tests. */
export type ThemeRoot = {
  setAttribute(name: string, value: string): void;
  setProperty(name: string, value: string): void;
};

/**
 * Applies one theme to a root surface.
 *
 * Sets the `data-theme` attribute to the appearance, names the theme in
 * `data-theme-id`, and writes every token as a custom property, so the
 * central Tailwind theme and the editor adapter receive the active palette.
 */
export function applyTheme(root: ThemeRoot, theme: Theme): void {
  root.setAttribute('data-theme', theme.appearance);
  root.setAttribute('data-theme-id', theme.id);
  for (const [property, value] of themeProperties(theme))
    root.setProperty(property, value);
}

/**
 * Applies one theme to the page document.
 *
 * Call this from the application entry point after the inline page script
 * already set the initial theme, so React state and the document stay in
 * sync without a visible flash. The browser interface colour follows the
 * page background, so an installed window keeps one palette.
 */
export function applyThemeToDocument(theme: Theme): void {
  const element = document.documentElement;
  applyTheme(
    {
      setAttribute: (name, value): void => {
        element.setAttribute(name, value);
      },
      setProperty: (name, value): void => {
        element.style.setProperty(name, value);
      },
    },
    theme,
  );
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta !== null) meta.setAttribute('content', theme.tokens.background);
}

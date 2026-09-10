/**
 * Tokyo Night theme resolution, tokens, and contrast helpers.
 *
 * The palette values below are copied from the upstream Tokyo Night Night and
 * Day palettes; see `THIRD_PARTY_LICENSES.md`. The semantic `*Text` variants
 * are derived within the palette.
 *
 * Contrast rules that `theme.test.ts` enforces per surface:
 *
 * - `text` is the body color of the main background and the card surface
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
 *
 * This module is the runtime palette source. `applyTheme` writes the values
 * as custom properties for the central Tailwind theme.
 */

/** The stored palette choice of an account. Matches the API `Theme` type. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** The palette that is actually rendered. */
export type ResolvedTheme = 'light' | 'dark';

/** The local settings key of the theme choice. The inline page script reads it. */
export const themeStorageKey = 'notesapp.theme';

/**
 * Selects the palette for a stored choice and the device preference.
 *
 * `system` follows the device: dark when `prefersDark` is true, light
 * otherwise. An explicit choice always wins over the device preference.
 */
export function resolveTheme(
  choice: ThemeChoice,
  prefersDark: boolean,
): ResolvedTheme {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

/**
 * Reads a theme choice from an untrusted stored value.
 *
 * Anything that is not one of the three known choices falls back to
 * `system`, so a corrupt setting cannot break rendering.
 */
export function parseThemeChoice(value: unknown): ThemeChoice {
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return 'system';
}

/**
 * Every color that the application shell needs, for one palette.
 *
 * `text` is the body color of the main background and the card surface.
 * `textStrong` and `textMuted` pass on every surface, so a sidebar row, a
 * hover state, and an active state always use one of those two. `accentText`,
 * `successText`, and `dangerText` are the derived variants for small text.
 * `accentFill` and `dangerFill` are control fills whose labels use
 * `accentOnFill` and `onDanger`. `scrim` is the fill behind a dialog; a page
 * applies it with an opacity utility.
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

/** Tokyo Night Night with accessible semantic variants. */
export const nightTokens: ThemeTokens = {
  background: '#1a1b26',
  surface: '#16161e',
  surfaceCard: '#1f2335',
  surfaceHover: '#24283b',
  surfaceActive: '#292e42',
  text: '#c0caf5',
  textStrong: '#e8ecff',
  textMuted: '#9099bd',
  accentText: '#7aa2f7',
  accentFill: '#7aa2f7',
  accentOnFill: '#0c0c14',
  successText: '#9ece6a',
  dangerText: '#f7768e',
  dangerFill: '#f7768e',
  onDanger: '#0c0c14',
  border: '#737ca3',
  borderSubtle: '#303349',
  focus: '#7aa2f7',
  scrim: '#0c0c14',
};

/** Tokyo Night Day with accessible semantic variants. */
export const dayTokens: ThemeTokens = {
  background: '#e1e2e7',
  surface: '#d0d5e3',
  surfaceCard: '#f2f4f8',
  surfaceHover: '#d8dce8',
  surfaceActive: '#c8cfde',
  text: '#3760bf',
  textStrong: '#2f3d67',
  textMuted: '#4a4e69',
  accentText: '#1c46c0',
  accentFill: '#1f4fd8',
  accentOnFill: '#ffffff',
  successText: '#3f5e2a',
  dangerText: '#a8154a',
  dangerFill: '#a8154a',
  onDanger: '#ffffff',
  border: '#5a6a8a',
  borderSubtle: '#b9c0d0',
  focus: '#1f4fd8',
  scrim: '#2f3d67',
};

/** Both palettes by resolved theme. */
export const themeTokens: Record<ResolvedTheme, ThemeTokens> = {
  light: dayTokens,
  dark: nightTokens,
};

/** Minimum WCAG contrast for normal text. */
export const textContrastMinimum = 4.5;

/** Minimum WCAG contrast for controls, borders, and focus indicators. */
export const uiContrastMinimum = 3;

/**
 * Parses a six digit hex color such as `#1a1b26`.
 *
 * Returns the red, green, and blue channels on a 0 to 1 scale, or `null`
 * when the input is not a six digit hex color.
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
 * Computes the WCAG relative luminance of a hex color.
 *
 * Returns `NaN` when the input is not a six digit hex color.
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
 * Computes the WCAG contrast ratio of two hex colors, from 1 to 21.
 *
 * Returns `NaN` when either input is not a six digit hex color.
 */
export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  if (Number.isNaN(firstLuminance) || Number.isNaN(secondLuminance)) return NaN;
  const lower = Math.min(firstLuminance, secondLuminance);
  const upper = Math.max(firstLuminance, secondLuminance);
  return (upper + 0.05) / (lower + 0.05);
}

/** The custom property names that `applyTheme` writes, in a fixed order. */
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

/** One of the property names of {@link themePropertyNames}. */
export type ThemePropertyName = (typeof themePropertyNames)[number];

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

/** The smallest surface that `applyTheme` can write to, for tests. */
export type ThemeRoot = {
  setAttribute(name: string, value: string): void;
  setProperty(name: string, value: string): void;
};

/**
 * Applies one palette to a root surface.
 *
 * Sets the `data-theme` attribute and writes every token as a custom
 * property, so the central Tailwind theme receives the active palette.
 */
export function applyTheme(root: ThemeRoot, theme: ResolvedTheme): void {
  root.setAttribute('data-theme', theme);
  const tokens = themeTokens[theme];
  for (const name of themePropertyNames) {
    root.setProperty(themePropertyName(name), tokens[name]);
  }
}

/**
 * Applies one palette to the page document.
 *
 * Call this from the application entry point after the inline page script
 * already set the initial theme, so React state and the document stay in
 * sync without a visible flash.
 */
export function applyThemeToDocument(theme: ResolvedTheme): void {
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
}

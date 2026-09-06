/**
 * Tokyo Night theme resolution, tokens, and contrast helpers.
 *
 * The palette values below are copied from the upstream Tokyo Night Night and
 * Day palettes; see `THIRD_PARTY_LICENSES.md` and the license notice in
 * `tokens.css`. The semantic `*Text` variants are derived within the palette
 * so that every text combination meets WCAG 2.2 AA contrast (4.5 to 1) on
 * both the main background and the sidebar surface. The accent, focus, and
 * border tokens meet the 3 to 1 non-text minimum on both surfaces.
 *
 * `tokens.css` mirrors these values for stylesheets. This module is the
 * runtime source: `applyTheme` writes the same values as custom properties,
 * so the application works even when a stylesheet loads late. Keep the two
 * files in sync by hand; `theme.test.ts` guards every combination here.
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
 * `text` is the main body color on the main background only. `textStrong` and
 * `textMuted` also pass on the sidebar surface, so every surface label uses
 * one of those two. `accentText`, `successText`,
 * and `dangerText` are the derived variants for small text; the bare
 * `accent`, `success`, and `danger` stay available for large text, icons with
 * a label, and graphics. `accentFill` is a control fill whose label uses
 * `accentOnFill`.
 */
export type ThemeTokens = {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly textStrong: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly accentText: string;
  readonly accentFill: string;
  readonly accentOnFill: string;
  readonly success: string;
  readonly successText: string;
  readonly danger: string;
  readonly dangerText: string;
  readonly border: string;
  readonly focus: string;
};

/** Tokyo Night Night with accessible semantic variants. */
export const nightTokens: ThemeTokens = {
  background: '#1a1b26',
  surface: '#16161e',
  text: '#c0caf5',
  textStrong: '#e8ecff',
  textMuted: '#8b93b8',
  accent: '#7aa2f7',
  accentText: '#7aa2f7',
  accentFill: '#7aa2f7',
  accentOnFill: '#0c0c14',
  success: '#9ece6a',
  successText: '#9ece6a',
  danger: '#f7768e',
  dangerText: '#f7768e',
  border: '#6b7499',
  focus: '#7aa2f7',
};

/** Tokyo Night Day with accessible semantic variants. */
export const dayTokens: ThemeTokens = {
  background: '#e1e2e7',
  surface: '#d0d5e3',
  text: '#3760bf',
  textStrong: '#2f3d67',
  textMuted: '#4a4e69',
  accent: '#2e7de9',
  accentText: '#1f4fd8',
  accentFill: '#1f4fd8',
  accentOnFill: '#ffffff',
  success: '#587539',
  successText: '#3f5e2a',
  danger: '#f52a65',
  dangerText: '#a8154a',
  border: '#5a6a8a',
  focus: '#1f4fd8',
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
  'text',
  'textStrong',
  'textMuted',
  'accent',
  'accentText',
  'accentFill',
  'accentOnFill',
  'success',
  'successText',
  'danger',
  'dangerText',
  'border',
  'focus',
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
  if (name === 'textStrong') return '--notes-text-strong';
  if (name === 'textMuted') return '--notes-text-muted';
  if (name === 'accentText') return '--notes-accent-text';
  if (name === 'accentFill') return '--notes-accent-fill';
  if (name === 'accentOnFill') return '--notes-accent-on-fill';
  if (name === 'successText') return '--notes-success-text';
  if (name === 'dangerText') return '--notes-danger-text';
  if (name === 'text') return '--notes-text';
  if (name === 'accent') return '--notes-accent';
  if (name === 'success') return '--notes-success';
  if (name === 'danger') return '--notes-danger';
  if (name === 'border') return '--notes-border';
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
 * Sets the `data-theme` attribute for the selectors in `tokens.css` and
 * writes every token as a custom property, so the first paint already has
 * the right colors even when the stylesheet is still loading.
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

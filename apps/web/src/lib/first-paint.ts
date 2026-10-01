/**
 * The palette data of the script that paints before React starts.
 *
 * The script of `apps/web/index.html` writes every custom property of one
 * theme before the first paint, so a reload never shows the wrong palette.
 * The build writes the registry into the script (`themeRegistry` in
 * `apps/web/vite.config.ts`), and the device keeps the chosen imported theme
 * under `importedPaletteStorageKey` (record 0143). Both write one shape from
 * the functions here, so the names and the values stay in one order.
 */
import {
  defaultThemeFamilyId,
  defaultThemeFor,
  importedFamilyPrefix,
  importedThemeFamily,
  readThemeFile,
  themeFamilies,
  themeFileText,
  themeProperties,
  type Theme,
  type ThemeFamily,
} from '@notesapp/ui';

/** One variant as the script receives it: its identifier and its values. */
export type InlineThemeVariant = {
  readonly id: string;
  readonly values: readonly string[];
};

/** The variants of one family, by appearance. */
export type InlineThemeVariants = Readonly<Record<string, InlineThemeVariant>>;

/**
 * Where the device keeps the palette of the chosen imported theme.
 *
 * The script of `apps/web/index.html` names the same key, and
 * `tests/integration/theme-variables.test.ts` holds the two together.
 */
export const importedPaletteStorageKey = 'notesapp.theme-imported';

/** The custom property names, in the order that every variant follows. */
export function inlinePropertyNames(): readonly string[] {
  return themeProperties(defaultThemeFor('dark')).map(([name]) => name);
}

/** One variant, with its values in the order of `inlinePropertyNames`. */
export function inlineVariant(theme: Theme): InlineThemeVariant {
  return {
    id: theme.id,
    values: themeProperties(theme).map(([, value]) => value),
  };
}

/** Every variant of one family, by appearance. */
export function inlineVariants(family: ThemeFamily): InlineThemeVariants {
  const variants: Record<string, InlineThemeVariant> = {};
  for (const theme of family.variants)
    variants[theme.appearance] = inlineVariant(theme);
  return variants;
}

/** The whole registry as the inline script receives it. */
export type InlineThemes = {
  readonly fallback: string;
  readonly properties: readonly string[];
  readonly families: Readonly<Record<string, InlineThemeVariants>>;
};

/**
 * The palette data of the script that runs before the first paint.
 *
 * The names are written once, and every theme lists its values in that same
 * order, so the whole registry stays small inside the document. The build
 * writes it into `apps/web/index.html` (`apps/web/vite.config.ts`).
 */
export function themeRegistry(): InlineThemes {
  const families: Record<string, InlineThemeVariants> = {};
  for (const family of themeFamilies)
    families[family.id] = inlineVariants(family);
  return {
    fallback: defaultThemeFamilyId,
    properties: inlinePropertyNames(),
    families,
  };
}

/** The palette data of the inline script, serialized. */
export function themeRegistryData(): string {
  return JSON.stringify(themeRegistry());
}

/**
 * The stored text of one imported family, for the script and for the device.
 *
 * The script paints `variants` only when the stored family names `family`,
 * so a stale entry of another family is never painted. `file` is the theme
 * file of the family, so the application knows the theme before the account
 * answers and does not repaint the default family over the first paint.
 */
export function inlineImportedFamily(family: ThemeFamily): string {
  return JSON.stringify({
    family: family.id,
    variants: inlineVariants(family),
    file: themeFileText(family),
  });
}

/**
 * The imported family that this device kept, when it is the one named.
 *
 * The text is storage that any script of the origin can write, so the file
 * passes the one reader of a theme file again, and anything else answers
 * `null`.
 */
export function keptImportedFamily(
  text: string | null,
  familyId: string,
): ThemeFamily | null {
  if (text === null || !familyId.startsWith(importedFamilyPrefix)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const members: ReadonlyMap<string, unknown> = new Map(Object.entries(parsed));
  const file = members.get('file');
  if (members.get('family') !== familyId || typeof file !== 'string')
    return null;
  const read = readThemeFile(file);
  return read.ok ? importedThemeFamily(familyId, read.theme) : null;
}

/**
 * The root of a document that no script paints.
 *
 * The shell document states `data-theme` before its script runs, so the
 * script and `applyTheme` always win there. A page that the server writes, a
 * published page or a legal page, states none (record 0151).
 */
export const devicePaletteRoot = ':root:not([data-theme])';

/** The declarations of one variant, with its colour scheme. */
function paletteDeclarations(theme: Theme): string {
  return [
    `color-scheme: ${theme.appearance};`,
    ...themeProperties(theme).map(([name, value]) => `${name}: ${value};`),
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * The palette of a document that holds no script, as stylesheet rules.
 *
 * The page cannot read the preference of the device in a script (record
 * 0031), so the stylesheet states the Default dark palette and, under the
 * light preference, the Default light palette. Both come from the registry,
 * so the page holds no colour value of its own. The build appends this text
 * to the one stylesheet (`apps/web/vite.config.ts`).
 */
export function devicePaletteCss(): string {
  return `${devicePaletteRoot} {
${paletteDeclarations(defaultThemeFor('dark'))}
}
@media (prefers-color-scheme: light) {
  ${devicePaletteRoot} {
${paletteDeclarations(defaultThemeFor('light'))
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
  }
}
`;
}

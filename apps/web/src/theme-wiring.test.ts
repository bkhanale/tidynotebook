/**
 * One palette source for the whole shell.
 *
 * The theme registry of `@notesapp/ui` is the only place a colour value may
 * live (audit UI-48). The shell document, the installed manifest, and the
 * editor all derive from it, and each of those paths used to hold its own
 * copy of the palette. These tests fail as soon as one of them holds a
 * colour again or stops covering the whole registry.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { syntaxTokenNames } from '@notesapp/editor';
import {
  defaultThemeFamilyId,
  defaultThemeFor,
  syntaxPropertyNames,
  themeFamilies,
  themePropertyNames,
  themes,
} from '@notesapp/ui';
import { themeRegistryData, webManifest } from '../vite.config.ts';

const web = resolve(fileURLToPath(import.meta.url), '../..');

/** The registry data as the inline script of the shell receives it. */
type InlineThemes = {
  readonly fallback: string;
  readonly properties: readonly string[];
  readonly families: Record<
    string,
    Record<string, { readonly id: string; readonly values: readonly string[] }>
  >;
};

const inline = JSON.parse(themeRegistryData()) as InlineThemes;

await test('the inline script carries every theme of the registry', () => {
  assert.equal(inline.fallback, defaultThemeFamilyId);
  assert.equal(
    inline.properties.length,
    themePropertyNames.length + syntaxPropertyNames.length,
  );
  assert.deepEqual(
    Object.keys(inline.families).sort(),
    [...themeFamilies.map((family) => family.id)].sort(),
  );
  let counted = 0;
  for (const family of themeFamilies) {
    const variants = inline.families[family.id];
    assert.ok(variants !== undefined, family.id);
    for (const theme of family.variants) {
      const variant = variants[theme.appearance];
      assert.ok(variant !== undefined, theme.id);
      assert.equal(variant.id, theme.id);
      assert.equal(variant.values.length, inline.properties.length);
      assert.equal(variant.values[0], theme.tokens.background);
      counted += 1;
    }
  }
  assert.equal(counted, themes.length);
});

await test('the shell document holds no colour of its own', () => {
  const noColour = async (name: string): Promise<void> => {
    const source = await readFile(resolve(web, name), 'utf8');
    const found = source.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    assert.deepEqual(found, [], `${name} holds a colour value`);
  };
  return Promise.all([
    noColour('index.html'),
    noColour('src/diagram/frame.html'),
  ]);
});

await test('the shell document takes its palette from the build', () => {
  return readFile(resolve(web, 'index.html'), 'utf8').then((html) => {
    assert.ok(html.includes('__NOTESAPP_THEMES__'));
    assert.ok(html.includes('__NOTESAPP_THEME_COLOUR__'));
  });
});

await test('the manifest takes its interface colour from the registry', () => {
  const manifest = JSON.parse(webManifest()) as {
    readonly theme_color: string;
    readonly background_color: string;
    readonly name: string;
  };
  const theme = defaultThemeFor('dark');
  assert.equal(manifest.theme_color, theme.tokens.background);
  assert.equal(manifest.background_color, theme.tokens.background);
  assert.equal(manifest.name, 'Notesapp');
});

await test('the editor reads exactly the syntax group of a theme', () => {
  assert.deepEqual([...syntaxTokenNames], [...syntaxPropertyNames]);
});

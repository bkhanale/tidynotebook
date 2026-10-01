import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultThemeFor, themeProperties } from '@notesapp/ui';
import { devicePaletteCss, devicePaletteRoot } from './first-paint.ts';

/** The declarations of one rule body, as a map from name to value. */
function declarationsOf(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/^\s*([a-z0-9-]+):\s*([^;]+);$/gm)].map(
      (match) => [match[1] ?? '', match[2] ?? ''] as const,
    ),
  );
}

await test('a page with no script states both default palettes', () => {
  // Issue 210: a published page drew the dark palette for every reader.
  const css = devicePaletteCss();
  const [outside, inside] = css.split('@media (prefers-color-scheme: light)');
  assert.ok(outside !== undefined && inside !== undefined, css);
  assert.ok(outside.trimStart().startsWith(`${devicePaletteRoot} {`));
  assert.ok(inside.includes(`${devicePaletteRoot} {`));
  for (const [body, appearance] of [
    [outside, 'dark'],
    [inside, 'light'],
  ] as const) {
    const declared = declarationsOf(body);
    assert.equal(declared.get('color-scheme'), appearance);
    const theme = defaultThemeFor(appearance);
    for (const [name, value] of themeProperties(theme))
      assert.equal(declared.get(name), value, `${appearance} ${name}`);
    assert.equal(declared.size, themeProperties(theme).length + 1);
  }
});

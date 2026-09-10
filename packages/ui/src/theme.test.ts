/**
 * UI theme unit tests.
 *
 * Theme resolution is a pure truth table. Contrast is checked per surface,
 * for the pairs the application actually renders, so the rules in the module
 * doc and the code agree. The surface list holds the five fills a screen can
 * paint: the page background, the sidebar surface, the card, and the hover
 * and active states of a row.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contrastRatio,
  parseHexColor,
  parseThemeChoice,
  relativeLuminance,
  resolveTheme,
  textContrastMinimum,
  themePropertyName,
  themePropertyNames,
  themeTokens,
  uiContrastMinimum,
  type ResolvedTheme,
  type ThemeTokens,
} from './theme.ts';

await test('system choice follows the device preference', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

await test('explicit choice wins over the device preference', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('dark', false), 'dark');
});

await test('unknown stored values fall back to system', () => {
  assert.equal(parseThemeChoice('light'), 'light');
  assert.equal(parseThemeChoice('dark'), 'dark');
  assert.equal(parseThemeChoice('system'), 'system');
  assert.equal(parseThemeChoice(undefined), 'system');
  assert.equal(parseThemeChoice('midnight'), 'system');
  assert.equal(parseThemeChoice(42), 'system');
});

await test('hex parsing accepts only six digit colors', () => {
  assert.deepEqual(parseHexColor('#1a1b26'), [26 / 255, 27 / 255, 38 / 255]);
  assert.equal(parseHexColor('#fff'), null);
  assert.equal(parseHexColor('1a1b26'), null);
  assert.equal(parseHexColor('#zzzzzz'), null);
});

await test('luminance and contrast match known anchors', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#1a1b26', '#1a1b26'), 1);
  assert.ok(Number.isNaN(contrastRatio('#fff', '#ffffff')));
});

const themes: readonly ResolvedTheme[] = ['dark', 'light'];

/** Every fill a screen paints behind text, named for the failure message. */
function surfacesOf(
  tokens: ThemeTokens,
): readonly (readonly [string, string])[] {
  return [
    ['page background', tokens.background],
    ['sidebar surface', tokens.surface],
    ['card', tokens.surfaceCard],
    ['row hover', tokens.surfaceHover],
    ['row active', tokens.surfaceActive],
  ];
}

for (const theme of themes) {
  await test(`${theme} body text passes on the surfaces that use it`, () => {
    const tokens = themeTokens[theme];
    for (const surface of [tokens.background, tokens.surfaceCard]) {
      assert.ok(
        contrastRatio(tokens.text, surface) >= textContrastMinimum,
        `body text on ${surface} in ${theme}`,
      );
    }
  });

  await test(`${theme} strong and muted text pass on every surface`, () => {
    const tokens = themeTokens[theme];
    for (const [name, surface] of surfacesOf(tokens)) {
      assert.ok(
        contrastRatio(tokens.textStrong, surface) >= textContrastMinimum,
        `strong text on the ${name} in ${theme}`,
      );
      assert.ok(
        contrastRatio(tokens.textMuted, surface) >= textContrastMinimum,
        `muted text on the ${name} in ${theme}`,
      );
    }
  });

  await test(`${theme} accent, success, and danger text pass on every surface`, () => {
    const tokens = themeTokens[theme];
    for (const [name, surface] of surfacesOf(tokens)) {
      assert.ok(
        contrastRatio(tokens.accentText, surface) >= textContrastMinimum,
        `accent text on the ${name} in ${theme}`,
      );
      assert.ok(
        contrastRatio(tokens.successText, surface) >= textContrastMinimum,
        `success text on the ${name} in ${theme}`,
      );
      assert.ok(
        contrastRatio(tokens.dangerText, surface) >= textContrastMinimum,
        `danger text on the ${name} in ${theme}`,
      );
    }
  });

  await test(`${theme} control fill labels pass on their fill`, () => {
    const tokens = themeTokens[theme];
    assert.ok(
      contrastRatio(tokens.accentOnFill, tokens.accentFill) >=
        textContrastMinimum,
      `accent fill label in ${theme}`,
    );
    assert.ok(
      contrastRatio(tokens.onDanger, tokens.dangerFill) >= textContrastMinimum,
      `danger fill label in ${theme}`,
    );
  });

  await test(`${theme} component edge and focus pass on every surface`, () => {
    const tokens = themeTokens[theme];
    for (const [name, surface] of surfacesOf(tokens)) {
      assert.ok(
        contrastRatio(tokens.border, surface) >= uiContrastMinimum,
        `component edge on the ${name} in ${theme}`,
      );
      assert.ok(
        contrastRatio(tokens.focus, surface) >= uiContrastMinimum,
        `focus ring on the ${name} in ${theme}`,
      );
    }
  });

  await test(`${theme} control fills pass as non-text against the page`, () => {
    const tokens = themeTokens[theme];
    assert.ok(
      contrastRatio(tokens.accentFill, tokens.background) >= uiContrastMinimum,
      `accent fill on the page background in ${theme}`,
    );
    assert.ok(
      contrastRatio(tokens.dangerFill, tokens.background) >= uiContrastMinimum,
      `danger fill on the page background in ${theme}`,
    );
  });

  await test(`${theme} scrim is darker than every surface it covers`, () => {
    const tokens = themeTokens[theme];
    const scrim = relativeLuminance(tokens.scrim);
    for (const [name, surface] of surfacesOf(tokens)) {
      assert.ok(
        scrim < relativeLuminance(surface),
        `scrim over the ${name} in ${theme}`,
      );
    }
  });

  await test(`${theme} decorative edge stays quieter than the component edge`, () => {
    const tokens = themeTokens[theme];
    assert.ok(
      contrastRatio(tokens.borderSubtle, tokens.background) <
        contrastRatio(tokens.border, tokens.background),
      `decorative edge in ${theme}`,
    );
  });
}

await test('day text uses the design table value on the main background', () => {
  assert.equal(themeTokens.light.text, '#3760bf');
  assert.equal(themeTokens.light.background, '#e1e2e7');
  assert.equal(themeTokens.light.surface, '#d0d5e3');
  assert.equal(themeTokens.dark.background, '#1a1b26');
  assert.equal(themeTokens.dark.surface, '#16161e');
  assert.equal(themeTokens.dark.text, '#c0caf5');
});

await test('themePropertyName maps every token to one property', () => {
  assert.equal(themePropertyName('surface'), '--notes-surface');
  assert.equal(themePropertyName('background'), '--notes-bg');
  assert.equal(themePropertyName('focus'), '--notes-focus');
  assert.equal(themePropertyName('scrim'), '--notes-scrim');
  assert.equal(themePropertyName('dangerFill'), '--notes-danger-fill');
  assert.equal(themePropertyName('onDanger'), '--notes-on-danger');
  const seen = new Set<string>();
  for (const name of themePropertyNames) {
    const property = themePropertyName(name);
    assert.ok(property.startsWith('--notes-'));
    assert.ok(!seen.has(property), `${property} is written twice`);
    seen.add(property);
  }
});

/**
 * UI theme unit tests.
 *
 * Theme resolution is a pure truth table. Contrast is checked by computing
 * the WCAG ratio of every semantic text and control combination on both the
 * main background and the sidebar surface, so a future token change that
 * breaks readability fails here instead of in a manual review.
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
  themeTokens,
  uiContrastMinimum,
  type ResolvedTheme,
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

for (const theme of themes) {
  await test(`${theme} body text passes on the main background`, () => {
    const tokens = themeTokens[theme];
    assert.ok(
      contrastRatio(tokens.text, tokens.background) >= textContrastMinimum,
      `text on background in ${theme}`,
    );
  });

  await test(`${theme} strong and muted text pass on both surfaces`, () => {
    const tokens = themeTokens[theme];
    for (const surface of [tokens.background, tokens.surface]) {
      assert.ok(
        contrastRatio(tokens.textStrong, surface) >= textContrastMinimum,
        `strong text on surface in ${theme}`,
      );
      assert.ok(
        contrastRatio(tokens.textMuted, surface) >= textContrastMinimum,
        `muted text on surface in ${theme}`,
      );
    }
  });

  await test(`${theme} accent, success, and danger text pass on both surfaces`, () => {
    const tokens = themeTokens[theme];
    for (const surface of [tokens.background, tokens.surface]) {
      assert.ok(
        contrastRatio(tokens.accentText, surface) >= textContrastMinimum,
        `accent text on surface in ${theme}`,
      );
      assert.ok(
        contrastRatio(tokens.successText, surface) >= textContrastMinimum,
        `success text on surface in ${theme}`,
      );
      assert.ok(
        contrastRatio(tokens.dangerText, surface) >= textContrastMinimum,
        `danger text on surface in ${theme}`,
      );
    }
  });

  await test(`${theme} control fill label passes on its fill`, () => {
    const tokens = themeTokens[theme];
    assert.ok(
      contrastRatio(tokens.accentOnFill, tokens.accentFill) >=
        textContrastMinimum,
      `fill label in ${theme}`,
    );
  });

  await test(`${theme} border and focus pass as non-text controls`, () => {
    const tokens = themeTokens[theme];
    for (const surface of [tokens.background, tokens.surface]) {
      assert.ok(
        contrastRatio(tokens.border, surface) >= uiContrastMinimum,
        `border on surface in ${theme}`,
      );
      assert.ok(
        contrastRatio(tokens.focus, surface) >= uiContrastMinimum,
        `focus on surface in ${theme}`,
      );
    }
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

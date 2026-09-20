/**
 * UI theme unit tests.
 *
 * Appearance resolution is a pure truth table. Contrast is checked per
 * surface, for the pairs the application actually renders, so the rules in
 * the module doc and the code agree. The surface list holds the five fills a
 * screen can paint: the page background, the sidebar surface, the card, and
 * the hover and active states of a row.
 *
 * Every check runs for every theme in the registry, so a new theme file is
 * held to the same rules as the ones that ship today and no variant can
 * reach a screen without meeting them.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTheme,
  colourSchemeProperty,
  contrastRatio,
  derivedPropertyName,
  derivedPropertyNames,
  derivedValue,
  fillHoverShift,
  mixHexColors,
  parseAppearanceChoice,
  parseHexColor,
  relativeLuminance,
  resolveAppearance,
  scrollbarProperty,
  scrollbarValue,
  shiftAwayFrom,
  syntaxPropertyName,
  syntaxPropertyNames,
  textContrastMinimum,
  themePropertyName,
  themePropertyNames,
  toneSurfaceBlend,
  uiContrastMinimum,
  type Theme,
  type ThemeTokens,
} from './theme.ts';
import {
  defaultThemeFamilyId,
  defaultThemeFor,
  findTheme,
  findThemeFamily,
  parseThemeFamilyId,
  themeFamilies,
  themeFor,
  themes,
} from './themes/index.ts';

await test('system choice follows the device preference', () => {
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
});

await test('explicit choice wins over the device preference', () => {
  assert.equal(resolveAppearance('light', true), 'light');
  assert.equal(resolveAppearance('light', false), 'light');
  assert.equal(resolveAppearance('dark', true), 'dark');
  assert.equal(resolveAppearance('dark', false), 'dark');
});

await test('unknown stored values fall back to system', () => {
  assert.equal(parseAppearanceChoice('light'), 'light');
  assert.equal(parseAppearanceChoice('dark'), 'dark');
  assert.equal(parseAppearanceChoice('system'), 'system');
  assert.equal(parseAppearanceChoice(undefined), 'system');
  assert.equal(parseAppearanceChoice('midnight'), 'system');
  assert.equal(parseAppearanceChoice(42), 'system');
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
  const name = theme.id;

  await test(`${name} body text passes on the surfaces that use it`, () => {
    const tokens = theme.tokens;
    for (const surface of [tokens.background, tokens.surfaceCard]) {
      assert.ok(
        contrastRatio(tokens.text, surface) >= textContrastMinimum,
        `body text on ${surface} in ${name}`,
      );
    }
  });

  await test(`${name} strong and muted text pass on every surface`, () => {
    const tokens = theme.tokens;
    for (const [surfaceName, surface] of surfacesOf(tokens)) {
      assert.ok(
        contrastRatio(tokens.textStrong, surface) >= textContrastMinimum,
        `strong text on the ${surfaceName} in ${name}`,
      );
      assert.ok(
        contrastRatio(tokens.textMuted, surface) >= textContrastMinimum,
        `muted text on the ${surfaceName} in ${name}`,
      );
    }
  });

  await test(`${name} accent, success, and danger text pass on every surface`, () => {
    const tokens = theme.tokens;
    for (const [surfaceName, surface] of surfacesOf(tokens)) {
      assert.ok(
        contrastRatio(tokens.accentText, surface) >= textContrastMinimum,
        `accent text on the ${surfaceName} in ${name}`,
      );
      assert.ok(
        contrastRatio(tokens.successText, surface) >= textContrastMinimum,
        `success text on the ${surfaceName} in ${name}`,
      );
      assert.ok(
        contrastRatio(tokens.dangerText, surface) >= textContrastMinimum,
        `danger text on the ${surfaceName} in ${name}`,
      );
    }
  });

  await test(`${name} every tone is readable on its own surface`, () => {
    // A notice paints the surface of its tone and writes on it (record 0065).
    // A tone surface is a fill and not the page, so a notice sets the strong
    // text on it, as every other fill of the product does. The tone itself is
    // there too, in the mark of the notice.
    const tokens = theme.tokens;
    for (const [tone, surfaceName] of [
      ['accentText', 'accentSurface'],
      ['successText', 'successSurface'],
      ['dangerText', 'dangerSurface'],
    ] as const) {
      const surface = derivedValue(tokens, surfaceName);
      assert.ok(parseHexColor(surface) !== null, `${surfaceName} in ${name}`);
      for (const label of [tone, 'textStrong', 'textMuted'] as const) {
        assert.ok(
          contrastRatio(tokens[label], surface) >= textContrastMinimum,
          `${label} on the ${surfaceName} in ${name}`,
        );
      }
    }
  });

  await test(`${name} control fill labels pass on their fill`, () => {
    const tokens = theme.tokens;
    assert.ok(
      contrastRatio(tokens.accentOnFill, tokens.accentFill) >=
        textContrastMinimum,
      `accent fill label in ${name}`,
    );
    assert.ok(
      contrastRatio(tokens.onDanger, tokens.dangerFill) >= textContrastMinimum,
      `danger fill label in ${name}`,
    );
  });

  await test(`${name} the hover fill of a control comes forward`, () => {
    const tokens = theme.tokens;
    for (const [fill, hover] of [
      ['accentFill', 'accentFillHover'],
      ['dangerFill', 'dangerFillHover'],
    ] as const) {
      const resting = tokens[fill];
      const hovered = derivedValue(tokens, hover);
      assert.ok(parseHexColor(hovered) !== null, `${hover} in ${name}`);
      assert.ok(
        contrastRatio(hovered, tokens.background) >
          contrastRatio(resting, tokens.background),
        `${hover} does not stand further from the page than ${fill} in ${name}`,
      );
    }
  });

  await test(`${name} control fill labels pass on the hover fill`, () => {
    const tokens = theme.tokens;
    assert.ok(
      contrastRatio(
        tokens.accentOnFill,
        derivedValue(tokens, 'accentFillHover'),
      ) >= textContrastMinimum,
      `accent fill label on the hover fill in ${name}`,
    );
    assert.ok(
      contrastRatio(tokens.onDanger, derivedValue(tokens, 'dangerFillHover')) >=
        textContrastMinimum,
      `danger fill label on the hover fill in ${name}`,
    );
  });

  await test(`${name} component edge and focus pass on every surface`, () => {
    const tokens = theme.tokens;
    for (const [surfaceName, surface] of surfacesOf(tokens)) {
      assert.ok(
        contrastRatio(tokens.border, surface) >= uiContrastMinimum,
        `component edge on the ${surfaceName} in ${name}`,
      );
      assert.ok(
        contrastRatio(tokens.focus, surface) >= uiContrastMinimum,
        `focus ring on the ${surfaceName} in ${name}`,
      );
    }
  });

  await test(`${name} control fills pass as non-text against the page`, () => {
    const tokens = theme.tokens;
    assert.ok(
      contrastRatio(tokens.accentFill, tokens.background) >= uiContrastMinimum,
      `accent fill on the page background in ${name}`,
    );
    assert.ok(
      contrastRatio(tokens.dangerFill, tokens.background) >= uiContrastMinimum,
      `danger fill on the page background in ${name}`,
    );
  });

  await test(`${name} scrim is darker than every surface it covers`, () => {
    const tokens = theme.tokens;
    const scrim = relativeLuminance(tokens.scrim);
    for (const [surfaceName, surface] of surfacesOf(tokens)) {
      assert.ok(
        scrim < relativeLuminance(surface),
        `scrim over the ${surfaceName} in ${name}`,
      );
    }
  });

  await test(`${name} decorative edge stays quieter than the component edge`, () => {
    const tokens = theme.tokens;
    assert.ok(
      contrastRatio(tokens.borderSubtle, tokens.background) <
        contrastRatio(tokens.border, tokens.background),
      `decorative edge in ${name}`,
    );
  });

  await test(`${name} divider sits between the two edges`, () => {
    const tokens = theme.tokens;
    const divider = derivedValue(tokens, 'borderLine');
    assert.ok(parseHexColor(divider) !== null, `divider colour in ${name}`);
    const found = contrastRatio(divider, tokens.background);
    assert.ok(
      found > contrastRatio(tokens.borderSubtle, tokens.background),
      `divider is not louder than the decorative edge in ${name}`,
    );
    assert.ok(
      found < contrastRatio(tokens.border, tokens.background),
      `divider is not quieter than the component edge in ${name}`,
    );
  });

  await test(`${name} code colours pass on the page and on a code block`, () => {
    const tokens = theme.tokens;
    for (const property of syntaxPropertyNames) {
      const colour = theme.syntax[property];
      assert.ok(
        contrastRatio(colour, tokens.background) >= textContrastMinimum,
        `${property} on the page background in ${name}`,
      );
      assert.ok(
        contrastRatio(colour, tokens.surfaceHover) >= textContrastMinimum,
        `${property} on a code block in ${name}`,
      );
    }
  });

  await test(`${name} states every colour as a six digit hex value`, () => {
    for (const property of themePropertyNames)
      assert.ok(
        parseHexColor(theme.tokens[property]) !== null,
        `${property} in ${name}`,
      );
    for (const property of derivedPropertyNames)
      assert.ok(
        parseHexColor(derivedValue(theme.tokens, property)) !== null,
        `${property} in ${name}`,
      );
    for (const property of syntaxPropertyNames)
      assert.ok(
        parseHexColor(theme.syntax[property]) !== null,
        `${property} in ${name}`,
      );
  });
}

await test('day and night keep the values of the design table', () => {
  const day = findTheme('tokyo-night-day');
  const night = findTheme('tokyo-night-night');
  assert.ok(day !== null && night !== null);
  assert.equal(day.tokens.text, '#3760bf');
  assert.equal(day.tokens.background, '#e1e2e7');
  assert.equal(day.tokens.surface, '#d0d5e3');
  assert.equal(night.tokens.background, '#1a1b26');
  assert.equal(night.tokens.surface, '#16161e');
  assert.equal(night.tokens.text, '#c0caf5');
});

await test('every family is identified once and names its source', () => {
  const seen = new Set<string>();
  for (const family of themeFamilies) {
    assert.ok(!seen.has(family.id), `${family.id} is registered twice`);
    seen.add(family.id);
    assert.ok(family.name !== '');
    assert.ok(family.source.project !== '');
    assert.ok(family.source.url.startsWith('https://'));
    assert.ok(family.source.licence !== '');
    assert.ok(family.variants.length > 0);
    assert.ok(family.variants.length <= 2);
  }
});

await test('every variant belongs to its family and is identified once', () => {
  const seen = new Set<string>();
  for (const family of themeFamilies) {
    const appearances = new Set<string>();
    for (const variant of family.variants) {
      assert.ok(!seen.has(variant.id), `${variant.id} is registered twice`);
      seen.add(variant.id);
      assert.equal(variant.family, family.id);
      assert.ok(!appearances.has(variant.appearance), `${family.id} repeats`);
      appearances.add(variant.appearance);
    }
  }
  assert.equal(seen.size, themes.length);
});

await test('a family answers both appearances', () => {
  for (const family of themeFamilies) {
    for (const appearance of ['light', 'dark'] as const) {
      const theme = themeFor(family.id, appearance);
      assert.equal(theme.family, family.id);
    }
  }
});

await test('an unknown family falls back to the default one', () => {
  assert.equal(themeFor('neon', 'dark').family, defaultThemeFamilyId);
  assert.equal(parseThemeFamilyId('neon'), defaultThemeFamilyId);
  assert.equal(parseThemeFamilyId(42), defaultThemeFamilyId);
  assert.equal(parseThemeFamilyId('nord'), 'nord');
  assert.equal(findThemeFamily('neon'), null);
  assert.equal(findTheme('neon'), null);
  assert.equal(defaultThemeFor('dark').id, 'default-dark');
  assert.equal(defaultThemeFor('light').id, 'default-light');
});

await test('a blend takes the stated share of the first colour', () => {
  assert.equal(mixHexColors('#000000', '#ffffff', 0), '#ffffff');
  assert.equal(mixHexColors('#000000', '#ffffff', 1), '#000000');
  assert.equal(mixHexColors('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHexColors('#fff', '#ffffff', 0.5), null);
  assert.equal(mixHexColors('#ffffff', 'white', 0.5), null);
});

await test('a palette with an unreadable edge falls back to the quiet edge', () => {
  const tokens = { ...defaultThemeFor('dark').tokens, border: 'rebeccapurple' };
  assert.equal(derivedValue(tokens, 'borderLine'), tokens.borderSubtle);
});

await test('a shift moves a colour away from its background', () => {
  // A light background darkens, a dark background lightens, and the share is
  // taken out of what is left, so neither direction can leave the range.
  assert.equal(shiftAwayFrom('#808080', '#ffffff', 0.5), '#404040');
  assert.equal(shiftAwayFrom('#808080', '#000000', 0.5), '#c0c0c0');
  assert.equal(shiftAwayFrom('#000000', '#ffffff', 0.5), '#000000');
  assert.equal(shiftAwayFrom('#ffffff', '#000000', 0.5), '#ffffff');
  assert.equal(shiftAwayFrom('#808080', '#ffffff', 0), '#808080');
  assert.equal(shiftAwayFrom('#fff', '#000000', 0.5), null);
  assert.equal(shiftAwayFrom('#808080', 'white', 0.5), null);
});

await test('a palette with an unreadable fill keeps that fill on hover', () => {
  const base = defaultThemeFor('dark').tokens;
  const tokens = { ...base, accentFill: 'rebeccapurple' };
  assert.equal(derivedValue(tokens, 'accentFillHover'), 'rebeccapurple');
});

await test('the hover shift is the one step of every control fill', () => {
  const tokens = defaultThemeFor('light').tokens;
  assert.equal(
    derivedValue(tokens, 'accentFillHover'),
    shiftAwayFrom(tokens.accentFill, tokens.background, fillHoverShift),
  );
  assert.equal(
    derivedValue(tokens, 'dangerFillHover'),
    shiftAwayFrom(tokens.dangerFill, tokens.background, fillHoverShift),
  );
});

await test('the tone blend is the one step of every tone surface', () => {
  const tokens = defaultThemeFor('light').tokens;
  for (const [tone, surface] of [
    ['accentText', 'accentSurface'],
    ['successText', 'successSurface'],
    ['dangerText', 'dangerSurface'],
  ] as const) {
    assert.equal(
      derivedValue(tokens, surface),
      mixHexColors(tokens[tone], tokens.background, toneSurfaceBlend),
    );
  }
});

await test('a palette with an unreadable tone keeps the page behind it', () => {
  const base = defaultThemeFor('dark').tokens;
  const tokens = { ...base, dangerText: 'rebeccapurple' };
  assert.equal(derivedValue(tokens, 'dangerSurface'), tokens.background);
});

await test('the default action is ink and the blue carries meaning', () => {
  // Decision 0062. The fill of the one action is near black on the light page
  // and near white on the dark page, and the blue stays where colour states a
  // meaning that no shape states: the link and the focus ring.
  const light = defaultThemeFor('light').tokens;
  const dark = defaultThemeFor('dark').tokens;
  assert.ok(relativeLuminance(light.accentFill) < 0.05, 'the light ink fill');
  assert.ok(relativeLuminance(dark.accentFill) > 0.8, 'the dark ink fill');
  assert.notEqual(light.accentFill, light.focus);
  assert.notEqual(dark.accentFill, dark.focus);
  assert.equal(light.accentText, '#1a63c4');
  assert.equal(dark.accentText, '#6fa8f5');
});

await test('themePropertyName maps every token to one property', () => {
  assert.equal(themePropertyName('surface'), '--notes-surface');
  assert.equal(themePropertyName('background'), '--notes-bg');
  assert.equal(themePropertyName('focus'), '--notes-focus');
  assert.equal(themePropertyName('scrim'), '--notes-scrim');
  assert.equal(themePropertyName('dangerFill'), '--notes-danger-fill');
  assert.equal(themePropertyName('onDanger'), '--notes-on-danger');
  assert.equal(syntaxPropertyName('keyword'), '--notes-syntax-keyword');
  const seen = new Set<string>();
  for (const name of themePropertyNames) {
    const property = themePropertyName(name);
    assert.ok(property.startsWith('--notes-'));
    assert.ok(!seen.has(property), `${property} is written twice`);
    seen.add(property);
  }
  assert.equal(derivedPropertyName('borderLine'), '--notes-border-line');
  assert.equal(
    derivedPropertyName('accentFillHover'),
    '--notes-accent-fill-hover',
  );
  assert.equal(
    derivedPropertyName('dangerFillHover'),
    '--notes-danger-fill-hover',
  );
  assert.equal(derivedPropertyName('accentSurface'), '--notes-accent-surface');
  assert.equal(
    derivedPropertyName('successSurface'),
    '--notes-success-surface',
  );
  assert.equal(derivedPropertyName('dangerSurface'), '--notes-danger-surface');
  for (const name of derivedPropertyNames) {
    const property = derivedPropertyName(name);
    assert.ok(property.startsWith('--notes-'));
    assert.ok(!seen.has(property), `${property} is written twice`);
    seen.add(property);
  }
  for (const name of syntaxPropertyNames) {
    const property = syntaxPropertyName(name);
    assert.ok(!seen.has(property), `${property} is written twice`);
    seen.add(property);
  }
});

await test('applying a theme writes every property and both attributes', () => {
  const theme: Theme = defaultThemeFor('dark');
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  applyTheme(
    {
      setAttribute: (key, value) => attributes.set(key, value),
      setProperty: (key, value) => properties.set(key, value),
    },
    theme,
  );
  assert.equal(attributes.get('data-theme'), 'dark');
  assert.equal(attributes.get('data-theme-id'), theme.id);
  assert.equal(
    properties.size,
    themePropertyNames.length +
      derivedPropertyNames.length +
      syntaxPropertyNames.length +
      2,
  );
  assert.equal(properties.get('--notes-bg'), theme.tokens.background);
  assert.equal(
    properties.get('--notes-border-line'),
    derivedValue(theme.tokens, 'borderLine'),
  );
  assert.equal(properties.get('--notes-syntax-comment'), theme.syntax.comment);
});

await test('the scrollbar takes the component edge of the palette', () => {
  // A scrollbar is a control that a person must see and grab, so its thumb is
  // the edge token that every palette holds to the non-text minimum. The
  // value names the property instead of copying a colour, so one write
  // follows every theme change.
  assert.equal(scrollbarValue, 'var(--notes-border) transparent');
  const properties = new Map<string, string>();
  applyTheme(
    {
      setAttribute: () => undefined,
      setProperty: (key, value) => properties.set(key, value),
    },
    defaultThemeFor('dark'),
  );
  assert.equal(properties.get(scrollbarProperty), scrollbarValue);
});

await test('every theme states its appearance as the colour scheme', () => {
  // The browser draws the scrollbar of every region that scrolls from this
  // one property. A dark palette with no colour scheme takes the light
  // scrollbar of the browser, which is what a person saw before this rule.
  for (const theme of themes) {
    const properties = new Map<string, string>();
    applyTheme(
      {
        setAttribute: () => undefined,
        setProperty: (key, value) => properties.set(key, value),
      },
      theme,
    );
    assert.equal(
      properties.get(colourSchemeProperty),
      theme.appearance,
      theme.id,
    );
  }
});

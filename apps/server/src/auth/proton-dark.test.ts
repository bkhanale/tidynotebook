import assert from 'node:assert/strict';
import test from 'node:test';
import { emailPalettes } from './email-template.ts';
import { emailExamples } from './fixtures/email-examples.ts';
import {
  contrast,
  protonColor,
  protonForeground,
  rgb,
} from './fixtures/proton-colors.ts';

await test('the Proton color model agrees with published upstream cases', () => {
  assert.equal(protonColor('#ffffff', 'background'), '#191927');
  assert.equal(protonColor('#fffffe', 'background'), '#16171d');
  assert.equal(protonColor('#000000', 'foreground'), '#ffffff');
  assert.equal(protonColor('#734026', 'background'), '#734026');
  assert.equal(protonColor('#1a1917', 'background'), '#1a1917');
});

await test('the action boundary survives Proton recoloring and full inversion', () => {
  for (const { name, message } of emailExamples) {
    assert.match(message.html, /border:2px solid currentColor/, name);
    assert.match(
      message.html,
      /stroke="t" strokecolor="#ffffff" strokeweight="2px"/,
      name,
    );
  }
  const invert = (hex: string) =>
    '#' +
    Object.values(rgb(hex))
      .map((value) =>
        Math.round((1 - value) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  for (const palette of Object.values(emailPalettes)) {
    const invertedCard = invert(palette.surfaceCard);
    const invertedFill = invert(palette.accentFill);
    const invertedText = invert(palette.accentOnFill);
    assert.ok(
      Math.max(
        contrast(invertedText, invertedCard),
        contrast(invertedFill, invertedCard),
      ) >= 3,
      'full inversion keeps a visible button boundary',
    );
    assert.ok(
      contrast(invertedText, invertedFill) >= 4.5,
      'full inversion keeps readable button text',
    );
    const card = protonColor(palette.surfaceCard, 'background');
    const fill = protonColor(palette.accentFill, 'background');
    const text = protonForeground(palette.accentOnFill, fill);
    // The border resolves currentColor after the foreground is transformed.
    assert.ok(contrast(text, card) >= 3, 'action boundary against the card');
    assert.ok(contrast(text, fill) >= 4.5, 'button text against its fill');
    assert.ok(
      contrast(protonForeground(palette.accentText), '#191927') >= 4.5,
      'link text',
    );
  }
});

await test('the light panel avoids the warm gray that Proton turns brown', () => {
  const neutral = protonColor(emailPalettes.light.surface, 'background');
  assert.equal(neutral, '#16171d');
  assert.notEqual(
    protonColor(emailPalettes.light.surfaceHover, 'background'),
    neutral,
  );
  for (const { name, message } of emailExamples) {
    assert.ok(
      message.html.includes(
        `class="panel" bgcolor="${emailPalettes.light.surface}"`,
      ),
      name,
    );
    assert.match(message.html, /a\{color:#1a63c4!important/, name);
    assert.match(
      message.html,
      /name="color-scheme" content="light dark"/,
      name,
    );
    assert.match(
      message.html,
      /name="supported-color-schemes" content="light dark"/,
      name,
    );
  }
});

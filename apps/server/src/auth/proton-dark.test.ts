import assert from 'node:assert/strict';
import test from 'node:test';
import { emailPalettes } from './email-template.ts';
import { emailExamples } from './fixtures/email-examples.ts';
import {
  contrast,
  protonColor,
  protonDeclarations,
  protonHsl,
  rgb,
} from './fixtures/proton-colors.ts';

await test('the model matches upstream cases 3, 4, 6, 7 and 8 with their original inputs', () => {
  assert.equal(protonHsl(20, 50, 70, 'foreground'), '#f2e1d9');
  assert.equal(protonHsl(20, 50, 30, 'foreground'), '#f2e1d9');
  assert.equal(protonHsl(20, 50, 93, 'background'), '#734026');
  assert.equal(protonHsl(0, 0, 100, 'background'), '#191927');
  assert.equal(protonColor('#fffffe', 'background'), '#16171d');
});

await test('the model agrees within one channel value with the owner sample, including the authored dark fill', () => {
  // Pixel values only. Never copy the inbox image or its live token into fixtures.
  for (const [input, sampled] of [
    ['#f7f7f5', '#16171c'],
    ['#ffffff', '#191926'],
    ['#f0efec', '#555145'],
    ['#ececea', '#16171c'],
  ] as const) {
    const actual = rgb(protonColor(input, 'background'));
    const expected = rgb(sampled);
    for (const channel of ['r', 'g', 'b'] as const)
      assert.ok(
        Math.abs(actual[channel] - expected[channel]) * 255 <= 1.00001,
        `${input}: ${channel}`,
      );
  }
});

await test('currentColor is skipped and unchanged inline fills create no override over dark CSS', () => {
  assert.equal(protonColor('currentColor', 'background'), 'currentColor');
  assert.deepEqual(
    protonDeclarations({
      'background-color': '#1a1917',
      'border-color': 'currentColor',
      color: '#ffffff',
    }),
    {},
  );
  assert.deepEqual(
    protonDeclarations({ 'background-color': '#ececea', color: '#141414' }),
    { 'background-color': '#16171d', color: '#ffffff' },
  );
});

await test('the action owns its fill and has a fixed border before currentColor', () => {
  for (const { name, message } of emailExamples) {
    assert.match(
      message.html,
      /class="button-cell"[^>]*style="border-radius:8px;mso-padding-alt:0"/,
      name,
    );
    assert.match(
      message.html,
      /class="button-link"[^>]*padding:10px 20px;background-color:#1a1917;border:2px solid #1a1917;border-color:currentColor/,
      name,
    );
    assert.match(
      message.html,
      /\.button-link\{background-color:#ececea!important\}/,
      name,
    );
    assert.match(
      message.html,
      /stroke="t" strokecolor="#ffffff" strokeweight="2px"/,
      name,
    );
  }
});

await test('the action boundary and label survive both Proton fill paths and full inversion', () => {
  const invert = (hex: string) =>
    '#' +
    Object.values(rgb(hex))
      .map((value) =>
        Math.round((1 - value) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  for (const fill of ['#1a1917', '#16171d']) {
    assert.ok(contrast('#ffffff', '#191927') >= 3, 'currentColor boundary');
    assert.ok(contrast('#ffffff', fill) >= 4.5, 'Proton label');
  }
  for (const palette of Object.values(emailPalettes)) {
    const card = invert(palette.surfaceCard),
      fill = invert(palette.accentFill),
      text = invert(palette.accentOnFill);
    assert.ok(Math.max(contrast(text, card), contrast(fill, card)) >= 3);
    assert.ok(contrast(text, fill) >= 4.5);
  }
});

await test('authored dark and Outlook dark rules include unclassed auto-links', () => {
  for (const { name, message } of emailExamples) {
    assert.match(message.html, /a\{color:#1a63c4!important/, name);
    assert.match(message.html, /a,\.link\{color:#6fa8f5!important\}/, name);
    for (const hook of ['data-ogsc', 'data-ogsb'])
      assert.ok(
        message.html.includes(
          `[${hook}] a,[${hook}] .link{color:#6fa8f5!important}`,
        ),
        name,
      );
    assert.ok(
      contrast(emailPalettes.dark.accentText, emailPalettes.dark.surfaceCard) >=
        4.5,
    );
    assert.ok(contrast(protonColor('#1a63c4', 'foreground'), '#191927') >= 4.5);
  }
  // Proton's own auto-link colour explains the purple in the inbox image.
  assert.ok(contrast('#8a6eff', '#191927') >= 4.5);
});

await test('the cool panel stays distinct in light, dark and both Proton paths', () => {
  for (const { name, message } of emailExamples) {
    const light = /class="panel" bgcolor="(#[0-9a-f]{6})"/.exec(
      message.html,
    )?.[1];
    const dark = /\.panel\{background-color:(#[0-9a-f]{6})!important\}/.exec(
      message.html,
    )?.[1];
    assert.ok(light && dark, name);
    assert.ok(contrast(light, emailPalettes.light.surfaceCard) >= 1.15, name);
    assert.ok(contrast(dark, emailPalettes.dark.surfaceCard) >= 1.15, name);
    assert.ok(contrast(emailPalettes.light.textMuted, light) >= 4.5, name);
    assert.ok(contrast(emailPalettes.dark.textMuted, dark) >= 4.5, name);
    for (const fill of [light, dark]) {
      const transformed = protonColor(fill, 'background');
      assert.ok(contrast(transformed, '#191927') >= 1.15, name);
      assert.ok(contrast('#ffffff', transformed) >= 4.5, name);
    }
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

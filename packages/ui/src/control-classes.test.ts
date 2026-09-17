/**
 * The class rules of a control that no other check can see.
 *
 * The contrast test in `theme.test.ts` proves every palette colour on every
 * surface it renders on. It cannot see a colour that a screen makes at paint
 * time with a filter or with an opacity modifier, and that was the fault
 * decision 0057 answers. These tests refuse both forms coming back.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  badgeClassName,
  buttonClassName,
  buttonName,
  type BadgeTone,
  type ButtonVariant,
} from './control-classes.ts';

/** Every button appearance, with the name a failure message reads. */
const variants: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'danger',
  'ghost',
  'subtle',
];

/** Every badge tone. */
const tones: readonly BadgeTone[] = ['default', 'accent', 'success', 'danger'];

/** A filter utility that makes a colour out of another colour. */
const colourFilter =
  /(?:^|:)(?:brightness|saturate|contrast|hue-rotate)-\d+|(?:^|:)(?:grayscale|invert|sepia)(?:-\d+)?$/;

/** A fill utility that takes a share of its colour instead of all of it. */
const fadedFill = /(?:^|:)bg-[a-z-]+\/\d+$/;

await test('no control makes a colour with a filter', () => {
  for (const variant of variants) {
    for (const part of buttonClassName({ variant }).split(' '))
      assert.ok(!colourFilter.test(part), `${part} of the ${variant} button`);
  }
  for (const tone of tones) {
    for (const part of badgeClassName(tone).split(' '))
      assert.ok(!colourFilter.test(part), `${part} of the ${tone} badge`);
  }
});

await test('a label never sits on a fill that is faded', () => {
  for (const variant of variants) {
    for (const part of buttonClassName({ variant }).split(' '))
      assert.ok(!fadedFill.test(part), `${part} of the ${variant} button`);
  }
  for (const tone of tones) {
    for (const part of badgeClassName(tone).split(' '))
      assert.ok(!fadedFill.test(part), `${part} of the ${tone} badge`);
  }
});

await test('a filled button states the hover fill of its own fill', () => {
  const primary = buttonClassName({ variant: 'primary' });
  assert.ok(primary.includes('bg-accent-fill '), 'the primary resting fill');
  assert.ok(
    primary.includes('hover:bg-accent-fill-hover'),
    'the primary hover fill',
  );
  const danger = buttonClassName({ variant: 'danger' });
  assert.ok(danger.includes('bg-danger-fill '), 'the danger resting fill');
  assert.ok(
    danger.includes('hover:bg-danger-fill-hover'),
    'the danger hover fill',
  );
});

await test('every badge tone sits on a surface the contrast test holds', () => {
  for (const tone of tones)
    assert.ok(badgeClassName(tone).includes('bg-hover'), `the ${tone} badge`);
});

await test('a button names one appearance and one size', () => {
  const seen = new Set<string>();
  for (const variant of variants) {
    const classes = buttonClassName({ variant });
    assert.ok(!seen.has(classes), `${variant} repeats another appearance`);
    seen.add(classes);
  }
  assert.ok(
    buttonClassName({ size: 'sm' }) !== buttonClassName({ size: 'md' }),
  );
  assert.equal(buttonClassName(), buttonClassName({ variant: 'primary' }));
  assert.ok(buttonClassName({ className: 'mt-2' }).endsWith('mt-2'));
});

await test('a label reaches a button that has no text', () => {
  const name = buttonName({ label: 'Close navigation', hasText: false });
  assert.equal(name.ariaLabel, 'Close navigation');
  assert.equal(name.title, 'Close navigation');
});

await test('a label reaches a button that also has text', () => {
  // The row actions of Trash and of the attention screen each show one word
  // and act on one note, so the label is the only thing that tells two rows
  // apart. Dropping it gave every row of the list the same name.
  const name = buttonName({ label: 'Restore Shopping list', hasText: true });
  assert.equal(name.ariaLabel, 'Restore Shopping list');
});

await test('a button with text carries no tooltip of its own', () => {
  const name = buttonName({ label: 'Restore Shopping list', hasText: true });
  assert.equal(name.title, undefined);
});

await test('an explicit title wins over the label', () => {
  const name = buttonName({
    label: 'Restore Shopping list',
    title: 'Restore this note',
    hasText: true,
  });
  assert.equal(name.title, 'Restore this note');
});

await test('a button with no label names itself by its text alone', () => {
  const name = buttonName({ hasText: true });
  assert.equal(name.ariaLabel, undefined);
  assert.equal(name.title, undefined);
});

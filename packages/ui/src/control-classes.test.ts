/**
 * The class rules of a control that no other check can see.
 *
 * The contrast test in `theme.test.ts` proves every palette colour on every
 * surface it renders on. It cannot see a colour that a screen makes at paint
 * time with a filter or with an opacity modifier, and that was the fault
 * decision 0057 answers. These tests refuse both forms coming back.
 *
 * They also hold the recipes of decision 0065 to one focus treatment, one
 * radius, one size scale, and to the resting edge of decision 0063.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  badgeClassName,
  buttonClassName,
  buttonName,
  compactIconVisualClassName,
  fieldClassName,
  focusOutline,
  focusOutlineInset,
  kbdClassName,
  rowClassName,
  type ButtonSize,
  type ButtonVariant,
} from './control-classes.ts';

/** Every button appearance, with the name a failure message reads. */
const variants: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'ghost',
  'danger',
];

/** Every button size. */
const sizes: readonly ButtonSize[] = ['sm', 'md'];

/** Every recipe of the module, with the name a failure message reads. */
const recipes: readonly (readonly [string, string])[] = [
  ...variants.map(
    (variant) => [`${variant} button`, buttonClassName({ variant })] as const,
  ),
  ...sizes.map(
    (size) => [`${size} button`, buttonClassName({ size })] as const,
  ),
  [
    'compact danger icon',
    compactIconVisualClassName({ variant: 'danger', size: 'sm' }),
  ],
  ['row', rowClassName()],
  ['selected row', rowClassName({ selected: true })],
  ['current row', rowClassName({ current: true })],
  ['container row', rowClassName({ interactive: false })],
  ['field', fieldClassName()],
  ['invalid field', fieldClassName({ invalid: true })],
  ['key cap', kbdClassName()],
  ['badge', badgeClassName()],
];

/** A filter utility that makes a colour out of another colour. */
const colourFilter =
  /(?:^|:)(?:brightness|saturate|contrast|hue-rotate)-\d+|(?:^|:)(?:grayscale|invert|sepia)(?:-\d+)?$/;

/** A fill utility that takes a share of its colour instead of all of it. */
const fadedFill = /(?:^|:)bg-[a-z-]+\/\d+$/;

await test('no control makes a colour with a filter', () => {
  for (const [name, classes] of recipes) {
    for (const part of classes.split(' '))
      assert.ok(!colourFilter.test(part), `${part} of the ${name}`);
  }
});

await test('a label never sits on a fill that is faded', () => {
  for (const [name, classes] of recipes) {
    for (const part of classes.split(' '))
      assert.ok(!fadedFill.test(part), `${part} of the ${name}`);
  }
});

await test('no recipe names the component edge', () => {
  // Decision 0063 reserves `edge` for a control whose state a person must
  // read with no text: a task box, a checkbox, a radio, a switch track and a
  // drop target. A recipe of this module is none of those.
  for (const [name, classes] of recipes) {
    for (const part of classes.split(' ')) {
      assert.ok(
        !/(?:^|:)(?:border|ring|outline)-edge$/.test(part),
        `${part} of the ${name}`,
      );
    }
  }
});

await test('no recipe draws a ring except the focus ring of a field', () => {
  for (const [name, classes] of recipes) {
    for (const part of classes.split(' ')) {
      if (!part.includes('ring-')) continue;
      assert.ok(
        name.endsWith('field') && part.startsWith('focus-visible:'),
        `${part} of the ${name}`,
      );
    }
  }
});

await test('every recipe takes one radius of the named scale', () => {
  for (const [name, classes] of recipes) {
    const found = classes
      .split(' ')
      .filter((part) => /(?:^|:)rounded(?:-|$)/.test(part));
    assert.equal(found.length, 1, `${name} names ${String(found.length)}`);
    assert.ok(
      ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl'].includes(
        found[0] ?? '',
      ),
      `${found[0] ?? ''} of the ${name}`,
    );
  }
});

await test('nothing scales when a person presses it', () => {
  for (const [name, classes] of recipes) {
    for (const part of classes.split(' '))
      assert.ok(!/scale-/.test(part), `${part} of the ${name}`);
  }
});

await test('the focus treatment is one outline of the focus colour', () => {
  assert.equal(
    focusOutline,
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  );
  assert.equal(
    focusOutlineInset,
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
  );
  for (const variant of variants)
    assert.ok(buttonClassName({ variant }).includes(focusOutline), variant);
});

await test('no recipe answers focus with the pointer prefix', () => {
  // `focus:` fires for a pointer press as well, so it leaves a ring on a
  // control a person already clicked. `focus-visible:` is the treatment.
  for (const [name, classes] of recipes) {
    for (const part of classes.split(' ')) {
      assert.ok(
        !/(?:^|\s)focus:/.test(part),
        `${part} of the ${name} uses focus: instead of focus-visible:`,
      );
    }
  }
});

await test('a quiet button takes the danger tone from the recipe', () => {
  const ghost = buttonClassName({ variant: 'ghost', tone: 'danger' });
  assert.ok(ghost.includes('text-danger hover:bg-danger-surface'));
  assert.ok(!ghost.includes('text-strong'));
  const secondary = buttonClassName({ variant: 'secondary', tone: 'danger' });
  assert.ok(secondary.includes('text-danger'));
  assert.ok(!secondary.includes('text-strong'));
  // The filled variants carry their own label colour and ignore the tone.
  assert.equal(
    buttonClassName({ variant: 'primary', tone: 'danger' }),
    buttonClassName({ variant: 'primary' }),
  );
});

await test('every button variant states its own fill and label', () => {
  assert.ok(
    buttonClassName({ variant: 'primary' }).includes(
      'bg-accent-fill text-on-accent hover:bg-accent-fill-hover',
    ),
  );
  assert.ok(
    buttonClassName({ variant: 'secondary' }).includes(
      'border border-edge-line bg-card text-strong shadow-raised hover:bg-hover',
    ),
  );
  assert.ok(
    buttonClassName({ variant: 'ghost' }).includes(
      'bg-transparent text-strong hover:bg-hover',
    ),
  );
  assert.ok(
    buttonClassName({ variant: 'danger' }).includes(
      'bg-danger-fill text-on-danger hover:bg-danger-fill-hover',
    ),
  );
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

await test('only the secondary button carries an edge', () => {
  for (const variant of variants) {
    const classes = buttonClassName({ variant });
    assert.equal(
      classes.split(' ').includes('border'),
      variant === 'secondary',
      variant,
    );
  }
});

await test('a button names one appearance and one size', () => {
  const seen = new Set<string>();
  for (const variant of variants) {
    const classes = buttonClassName({ variant });
    assert.ok(!seen.has(classes), `${variant} repeats another appearance`);
    seen.add(classes);
  }
  assert.equal(buttonClassName(), buttonClassName({ variant: 'primary' }));
  assert.ok(buttonClassName({ className: 'mt-2' }).endsWith('mt-2'));
});

await test('a button is 32 px on a desktop and 28 px when it is small', () => {
  const medium = buttonClassName({ size: 'md' }).split(' ');
  assert.ok(medium.includes('min-h-11'), 'the touch minimum');
  assert.ok(medium.includes('md:min-h-8'), 'the desktop control height');
  const small = buttonClassName({ size: 'sm' }).split(' ');
  assert.ok(small.includes('min-h-11'), 'the touch minimum');
  assert.ok(small.includes('md:min-h-7'), 'the small desktop height');
});

await test('a compact icon keeps its touch target and reduces its visible surface', () => {
  const button = buttonClassName({
    variant: 'danger',
    size: 'sm',
    iconOnly: true,
    compactIcon: true,
  });
  const visual = compactIconVisualClassName({
    variant: 'danger',
    size: 'sm',
  });

  assert.ok(button.includes('size-11'), 'the square touch target');
  assert.ok(button.includes('px-0'), 'the icon has no text inset');
  assert.ok(!button.includes('px-2.5'), 'the text inset does not squeeze it');
  assert.ok(button.includes('group'), 'the visual state owner');
  assert.ok(
    button.includes('focus-visible:outline-none'),
    'the outer target has no second outline',
  );
  assert.ok(!button.includes('bg-danger-fill'), 'the outer target has no fill');
  assert.ok(visual.includes('size-8'), 'the visible touch surface');
  assert.ok(visual.includes('md:size-7'), 'the small desktop surface');
  assert.ok(visual.includes('bg-danger-fill'), 'the confirmation fill');
  assert.ok(
    visual.includes('group-focus-visible:outline-focus'),
    'the visible focus surface',
  );
});

await test('a row is 28 px on a desktop and 44 px under touch', () => {
  const parts = rowClassName().split(' ');
  assert.ok(parts.includes('min-h-11'), 'the touch minimum');
  assert.ok(parts.includes('md:min-h-7'), 'the desktop row height');
  assert.ok(parts.includes('rounded-md'), 'the row radius');
  assert.ok(parts.includes('px-2'), 'the row inset');
});

await test('a row offsets its outline inward unless it is told not to', () => {
  assert.ok(rowClassName().includes(focusOutlineInset), 'the default row');
  assert.ok(
    !rowClassName().includes('focus-visible:outline-offset-2'),
    'the default row takes no outward offset',
  );
  assert.ok(
    rowClassName({ inset: false }).includes(focusOutline),
    'a row that stands on its own',
  );
});

await test('a marked row states one mark for a choice and for a route', () => {
  const selected = rowClassName({ selected: true });
  const current = rowClassName({ current: true });
  assert.equal(selected, current);
  assert.ok(selected.includes('bg-active text-strong font-medium'));
  // A marked row has nothing left to say on hover, so it states no hover.
  assert.ok(!selected.includes('hover:'), 'a marked row repeats its own mark');
  assert.ok(rowClassName().includes('hover:bg-hover hover:text-strong'));
});

await test('a row that only holds actions promises none of its own', () => {
  const container = rowClassName({ interactive: false });
  assert.ok(!container.includes('cursor-pointer'), 'the pointer');
  assert.ok(!container.includes('hover:'), 'the hover fill');
  assert.ok(!container.includes('focus-visible:'), 'the focus outline');
  assert.ok(container.includes('min-h-11'), 'the size of a row');
});

await test('a field rests on the divider and answers focus on it', () => {
  const field = fieldClassName();
  assert.ok(field.includes('border-edge-line'), 'the resting edge');
  assert.ok(field.includes('focus-visible:border-focus'), 'the active edge');
  assert.ok(field.includes('focus-visible:ring-2'), 'the focus ring');
  assert.ok(field.includes('focus-visible:ring-focus/25'), 'the ring strength');
  assert.ok(field.includes('bg-app'), 'the field fill');
  assert.ok(field.includes('min-h-11'), 'the touch minimum');
  assert.ok(field.includes('md:min-h-8'), 'the desktop field height');
});

await test('an invalid field states the error on its edge alone', () => {
  const invalid = fieldClassName({ invalid: true });
  assert.ok(invalid.includes('border-danger'), 'the error edge');
  assert.ok(!invalid.includes('border-edge-line'), 'the resting edge is gone');
  assert.ok(!invalid.includes('bg-danger'), 'an error is not a fill');
});

await test('a key cap is the quietest step in the code face', () => {
  const cap = kbdClassName();
  assert.ok(cap.includes('text-kbd'), 'the keyboard step');
  assert.ok(cap.includes('font-mono'), 'the code face');
  assert.ok(cap.includes('border-edge-line'), 'the resting edge');
  assert.ok(cap.includes('rounded-sm'), 'the smallest radius');
});

await test('a badge sits on a surface the contrast test holds', () => {
  assert.ok(badgeClassName().includes('bg-hover'));
  assert.ok(badgeClassName().includes('text-muted'));
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

await test('a row that destroys something reads in the danger tone', () => {
  // The defect this covers: a caller appended `text-danger` to this recipe,
  // and the stylesheet puts `text-danger` before `text-ink`, so the recipe
  // won and every Delete row of the product read like every other row. The
  // tone is part of the recipe now, and it replaces the colour instead of
  // competing with it.
  const danger = rowClassName({ danger: true }).split(' ');
  assert.ok(danger.includes('text-danger'), 'the danger tone');
  assert.ok(!danger.includes('text-ink'), 'one colour for one row');
  assert.ok(!danger.includes('text-strong'), 'the tone survives the hover');
  assert.ok(!danger.includes('hover:text-strong'), 'the tone survives a hover');
  // A marked danger row keeps its fill and its weight.
  const marked = rowClassName({ danger: true, current: true }).split(' ');
  assert.ok(marked.includes('bg-active'), 'the mark of the open route');
  assert.ok(marked.includes('font-medium'), 'the weight of a marked row');
  assert.ok(marked.includes('text-danger'), 'the tone of the row');
});

await test('a row with no tone reads in the ink and marks in the strong text', () => {
  const quiet = rowClassName().split(' ');
  assert.ok(quiet.includes('text-ink'), 'the resting colour');
  assert.ok(quiet.includes('hover:text-strong'), 'the hover colour');
  const marked = rowClassName({ selected: true }).split(' ');
  assert.ok(marked.includes('text-strong'), 'the colour of a marked row');
  assert.ok(marked.includes('bg-active'), 'the fill of a marked row');
});

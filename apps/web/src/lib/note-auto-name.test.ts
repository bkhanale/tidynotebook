import assert from 'node:assert/strict';
import test from 'node:test';
import { previewStructureOf } from '@notesapp/editor';
import {
  automaticPath,
  firstBlockOf,
  followsHeading,
  isPlaceholderName,
  maxHeadingNameLength,
  nameFromHeading,
} from './note-auto-name.ts';

/** The heading name of a text, read with the one grammar as the editor does. */
function headingOf(text: string): string | null {
  const first = previewStructureOf(firstBlockOf(text))[0];
  return first?.kind === 'heading' ? nameFromHeading(first.text) : null;
}

const notes = [
  { fileId: 'own', path: 'Trips/New note.md' },
  { fileId: 'other', path: 'Trips/Lisbon.md' },
];

await test('a new note takes its name from its first heading', () => {
  // Issue 252: the name stayed New note when the first line was a heading.
  assert.equal(
    automaticPath({
      currentPath: 'Trips/New note.md',
      lastHeading: null,
      heading: headingOf('# Trip to Porto\n\nPack the bags.'),
      notes,
      fileId: 'own',
    }),
    'Trips/Trip to Porto.md',
  );
});

await test('the name follows a heading that changes', () => {
  assert.equal(
    automaticPath({
      currentPath: 'Trips/Trip to Porto.md',
      lastHeading: 'Trip to Porto',
      heading: 'Trip to Faro',
      notes,
      fileId: 'own',
    }),
    'Trips/Trip to Faro.md',
  );
});

await test('a name a person chose stops the rule', () => {
  assert.equal(
    automaticPath({
      currentPath: 'Trips/Travel.md',
      lastHeading: 'Trip to Porto',
      heading: 'Trip to Faro',
      notes,
      fileId: 'own',
    }),
    null,
  );
  assert.ok(!followsHeading('Travel', 'Trip to Porto'));
  assert.ok(!followsHeading('Plan copy', 'Plan'));
});

await test('a heading that another note holds takes the next free number', () => {
  assert.equal(
    automaticPath({
      currentPath: 'Trips/New note.md',
      lastHeading: null,
      heading: 'lisbon',
      notes,
      fileId: 'own',
    }),
    'Trips/lisbon 2.md',
  );
  // The numbered name follows the heading, and keeps its number.
  assert.ok(followsHeading('lisbon 2', 'lisbon'));
  assert.equal(
    automaticPath({
      currentPath: 'Trips/lisbon 2.md',
      lastHeading: 'lisbon',
      heading: 'Lisbon',
      notes,
      fileId: 'own',
    }),
    null,
  );
});

await test('a note that starts with no heading keeps its name', () => {
  for (const text of [
    'Pack the bags.',
    '- [ ] call the bank',
    '```\ncode\n```',
    '',
  ])
    assert.equal(headingOf(text), null, text);
  assert.equal(
    automaticPath({
      currentPath: 'New note.md',
      lastHeading: null,
      heading: null,
      notes,
      fileId: 'own',
    }),
    null,
  );
});

await test('a heading below the first block names nothing', () => {
  assert.equal(headingOf('Intro line.\n\n# A section'), null);
  assert.equal(headingOf('\n\n## Second level\nText'), 'Second level');
  assert.equal(headingOf('Title\n=====\n\nText'), 'Title');
});

await test('the marks of a heading do not reach the name', () => {
  assert.equal(
    headingOf('# The **bold** [plan](https://x.test)'),
    'The bold plan',
  );
});

await test('a heading name holds no folder, no hidden character, no suffix', () => {
  assert.equal(nameFromHeading('Q1 / Q2 plans'), 'Q1 - Q2 plans');
  assert.equal(nameFromHeading('a\\b'), 'a-b');
  assert.equal(nameFromHeading('One\u200btwo'), 'One two');
  assert.equal(nameFromHeading('notes.md'), 'notes');
  assert.equal(nameFromHeading('   '), null);
  assert.equal(nameFromHeading('..'), null);
});

await test('a long heading is cut at a word', () => {
  const long = 'word '.repeat(30).trim();
  const name = nameFromHeading(long) ?? '';
  assert.ok(name.length <= maxHeadingNameLength);
  assert.ok(name.endsWith('word'));
  // A cut never splits a character that a person reads as one, and it
  // stops where the name and its suffix fill the 255 bytes of a segment.
  const flag = '\u{1F1F5}\u{1F1F9}';
  assert.equal(nameFromHeading(flag.repeat(70)), flag.repeat(31));
  assert.equal(nameFromHeading(flag.repeat(3)), flag.repeat(3));
});

await test('the placeholder of a new note is automatic', () => {
  assert.ok(isPlaceholderName('New note'));
  assert.ok(isPlaceholderName('New note 2'));
  assert.ok(isPlaceholderName('New note 14'));
  assert.ok(!isPlaceholderName('New note 1'));
  assert.ok(!isPlaceholderName('New notes'));
  assert.ok(followsHeading('New note 3', null));
});

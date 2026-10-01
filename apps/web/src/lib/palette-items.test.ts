import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionIconNames,
  mergeHits,
  rankActions,
  activeRowIndex,
  pickAnnouncement,
  rankChoices,
  rankNotes,
  type PaletteAction,
  type PaletteChoice,
  type PaletteHit,
  type PaletteNote,
} from './palette-items.ts';

const notes: readonly PaletteNote[] = [
  { fileId: 'a', path: 'plans/roadmap.md', updatedAt: '2026-01-03T00:00:00Z' },
  { fileId: 'b', path: 'roadmap notes.md', updatedAt: '2026-01-05T00:00:00Z' },
  { fileId: 'c', path: 'shopping.md', updatedAt: '2026-01-04T00:00:00Z' },
];

/** One excerpt with the query word marked, as the search operations give it. */
function excerpt(
  before: string,
  word: string,
  after: string,
): readonly { readonly text: string; readonly marked: boolean }[] {
  return [
    { text: before, marked: false },
    { text: word, marked: true },
    { text: after, marked: false },
  ];
}

const hits: readonly PaletteHit[] = [
  {
    fileId: 'c',
    path: 'shopping.md',
    excerpt: excerpt('the ', 'roadmap', ' is in the fridge'),
  },
  {
    fileId: 'a',
    path: 'plans/roadmap.md',
    excerpt: excerpt('', 'roadmap', ' of the year'),
  },
];

await test('an empty query lists the notes that changed last', () => {
  const ranked = rankNotes('', notes, [], 2);
  assert.deepEqual(
    ranked.map((match) => match.fileId),
    ['b', 'c'],
  );
  assert.equal(ranked[0]?.excerpt, null);
});

await test('a name match comes before a content match', () => {
  const ranked = rankNotes('roadmap', notes, hits, 10);
  assert.deepEqual(
    ranked.map((match) => match.fileId),
    ['b', 'a', 'c'],
  );
  assert.equal(ranked[0]?.excerpt, null);
  assert.equal(ranked[1]?.excerpt, null);
  assert.deepEqual(
    ranked[2]?.excerpt,
    excerpt('the ', 'roadmap', ' is in the fridge'),
  );
});

await test('a note that matches twice is listed once', () => {
  const ranked = rankNotes('roadmap', notes, hits, 10);
  const seen = new Set(ranked.map((match) => match.fileId));
  assert.equal(seen.size, ranked.length);
});

await test('server and local hits merge with the local one winning', () => {
  const stored = excerpt('', 'old', '');
  const drafted = excerpt('', 'new', '');
  const merged = mergeHits(
    [{ fileId: 'a', path: 'a.md', excerpt: stored }],
    [{ fileId: 'a', path: 'a.md', excerpt: drafted }],
  );
  assert.deepEqual(merged, [{ fileId: 'a', path: 'a.md', excerpt: drafted }]);
});

await test('a content match keeps the rank of the search that gave it', () => {
  const ranked = rankNotes('roadmap', [], hits, 10);
  assert.deepEqual(
    ranked.map((match) => match.fileId),
    ['c', 'a'],
  );
});

const actions: readonly PaletteAction[] = [
  { id: 'new', label: 'New note', icon: 'new-note', run: () => {} },
  {
    id: 'theme',
    label: 'Toggle theme',
    keywords: 'dark light',
    icon: 'theme-light',
    run: () => {},
  },
  { id: 'trash', label: 'Go to Trash', icon: 'trash', run: () => {} },
];

await test('an empty query keeps every action', () => {
  assert.equal(rankActions('', actions).length, 3);
});

await test('an action is found by its label and by its keywords', () => {
  assert.deepEqual(
    rankActions('dark', actions).map((action) => action.id),
    ['theme'],
  );
  assert.deepEqual(
    rankActions('trash', actions).map((action) => action.id),
    ['trash'],
  );
  assert.deepEqual(rankActions('nothing here', actions), []);
});

await test('every action names one glyph of the one list', () => {
  // The type holds this for the application, and this holds it for the list
  // itself: a name that no action can write is a glyph nobody draws, and a
  // name written twice is one action with two marks.
  for (const action of actions)
    assert.ok(
      actionIconNames.includes(action.icon),
      `${action.id} names no glyph`,
    );
  assert.equal(new Set(actionIconNames).size, actionIconNames.length);
  for (const name of actionIconNames)
    assert.match(name, /^[a-z]+(?:-[a-z]+)*$/);
});

await test('a ranked action keeps the glyph it named', () => {
  const ranked = rankActions('dark', actions);
  assert.deepEqual(
    ranked.map((action) => action.icon),
    ['theme-light'],
  );
});

const choices: readonly PaletteChoice[] = [
  { id: 'g', label: 'Groceries', detail: null },
  { id: 'm', label: 'Meeting', detail: 'Work' },
  { id: 'w', label: 'Weekly groceries', detail: 'Home' },
  { id: 'h', label: 'Habits', detail: 'Home' },
];

await test('an empty query keeps every choice in the order of the caller', () => {
  assert.deepEqual(rankChoices('', choices), choices);
  assert.deepEqual(rankChoices('   ', choices), choices);
});

await test('a choice whose name matches earlier comes first', () => {
  assert.deepEqual(
    rankChoices('groc', choices).map((choice) => choice.id),
    ['g', 'w'],
  );
  assert.deepEqual(
    rankChoices('MEET', choices).map((choice) => choice.id),
    ['m'],
  );
  assert.deepEqual(rankChoices('nothing here', choices), []);
});

await test('a choice whose folder alone matches follows the name matches', () => {
  // `Home` names no choice, so both choices in that folder answer, and a
  // choice is never listed twice when its name and its folder both match.
  assert.deepEqual(
    rankChoices('home', choices).map((choice) => choice.id),
    ['w', 'h'],
  );
  assert.deepEqual(
    rankChoices('work', choices).map((choice) => choice.id),
    ['m'],
  );
});

await test('an action that opens a step names its choices and no run', () => {
  const pick: PaletteAction = {
    id: 'insert-template',
    label: 'Insert from template',
    icon: 'template',
    pick: {
      placeholder: 'Search templates',
      choices: () => ({ status: 'ready', choices, notice: null }),
      empty: { title: 'No templates', description: '', action: null },
      noMatch: 'No template matches that.',
      choose: () => {},
    },
  };
  assert.equal(pick.run, undefined);
  assert.deepEqual(
    rankActions('template', [...actions, pick]).map((action) => action.id),
    ['insert-template'],
  );
});

await test('a step announces its name and what it lists now', () => {
  const pick = {
    placeholder: 'Search templates',
    choices: () => ({ status: 'ready' as const, choices, notice: null }),
    empty: {
      title: 'No templates',
      description: 'Add a note to the folder Templates.',
      action: null,
    },
    noMatch: 'No template matches that.',
    choose: (): void => {},
  };
  const label = 'Insert from template';
  const ready = { status: 'ready' as const, choices, notice: null };
  assert.equal(
    pickAnnouncement(label, pick, ready, 4),
    'Insert from template. 4 results.',
  );
  assert.equal(
    pickAnnouncement(label, pick, ready, 1),
    'Insert from template. 1 result.',
  );
  assert.equal(
    pickAnnouncement(label, pick, ready, 0),
    'Insert from template. No template matches that.',
  );
  assert.equal(
    pickAnnouncement(label, pick, { ...ready, choices: [] }, 0),
    'Insert from template. No templates. Add a note to the folder Templates.',
  );
  assert.equal(
    pickAnnouncement(label, pick, { status: 'loading', label: 'Loading.' }, 0),
    'Insert from template. Loading.',
  );
  assert.equal(
    pickAnnouncement(
      label,
      pick,
      { status: 'unavailable', message: 'Connect and try again.' },
      0,
    ),
    'Insert from template. Connect and try again.',
  );
  assert.equal(
    pickAnnouncement(label, pick, { ...ready, notice: 'Partial.' }, 2),
    'Insert from template. 2 results. Partial.',
  );
});

await test('the marked row is always a row of the list', () => {
  assert.equal(activeRowIndex(0, 3), 0);
  assert.equal(activeRowIndex(2, 3), 2);
  // A pointer over a row of a longer list leaves its place past the end of
  // the list that the next keystroke makes.
  assert.equal(activeRowIndex(7, 1), 0);
  assert.equal(activeRowIndex(-1, 2), 0);
  assert.equal(activeRowIndex(4, 0), -1);
});

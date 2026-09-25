/**
 * The daily notes of a workspace on this device.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDailyNoteLayout } from '@notesapp/core';
import {
  dailyNoteOf,
  dailyNotePreview,
  dailyNoteProblems,
  dailyNoteSettingsKey,
  daysWithNotes,
  effectiveTemplateId,
  formatCachedSettings,
  layoutProblemSentences,
  layoutToStore,
  noTemplateValue,
  opensTodayAtStart,
  parseCachedSettings,
  settingsProblem,
  templateChoices,
  templateOfChoice,
} from './daily-note.ts';

const notes = [
  { fileId: 'a', path: 'Daily notes/2026-09-24.md' },
  { fileId: 'b', path: 'Daily notes/2026-09-03.md' },
  { fileId: 'c', path: 'Daily notes/2026-10-01.md' },
  { fileId: 'd', path: 'Daily notes/Plans.md' },
  { fileId: 'e', path: 'Templates/Day.md' },
  { fileId: 'f', path: 'inbox.md' },
];

await test('the note of a date is the note at its dated path', () => {
  assert.equal(
    dailyNoteOf(
      notes,
      { year: 2026, month: 9, day: 24 },
      defaultDailyNoteLayout,
    ),
    'a',
  );
  assert.equal(
    dailyNoteOf(
      notes,
      { year: 2026, month: 9, day: 25 },
      defaultDailyNoteLayout,
    ),
    null,
  );
  // A note at another path is not the note of that date, even by its name.
  assert.equal(
    dailyNoteOf(
      [{ fileId: 'x', path: 'Old/2026-09-24.md' }],
      { year: 2026, month: 9, day: 24 },
      defaultDailyNoteLayout,
    ),
    null,
  );
});

await test('the days of a month with a note are the days of its daily notes', () => {
  assert.deepEqual(
    [
      ...daysWithNotes(notes, { year: 2026, month: 9 }, defaultDailyNoteLayout),
    ].sort((l, r) => l - r),
    [3, 24],
  );
  assert.deepEqual(
    [
      ...daysWithNotes(
        notes,
        { year: 2026, month: 10 },
        defaultDailyNoteLayout,
      ),
    ],
    [1],
  );
  assert.deepEqual(
    [...daysWithNotes(notes, { year: 2025, month: 9 }, defaultDailyNoteLayout)],
    [],
  );
});

await test('a template counts while it is a live note of the list', () => {
  assert.equal(
    effectiveTemplateId(
      { templateFileId: 'e', openOnStart: false, ...defaultDailyNoteLayout },
      notes,
    ),
    'e',
  );
  // In Trash, or gone: the note is not in the list of live notes.
  assert.equal(
    effectiveTemplateId(
      { templateFileId: 'gone', openOnStart: false, ...defaultDailyNoteLayout },
      notes,
    ),
    null,
  );
  assert.equal(
    effectiveTemplateId(
      { templateFileId: null, openOnStart: true, ...defaultDailyNoteLayout },
      notes,
    ),
    null,
  );
});

await test('the template choices start with no template and name each note', () => {
  const choices = templateChoices([
    { fileId: 'e', path: 'Templates/Day.md' },
    { fileId: 'f', path: 'inbox.md' },
    { fileId: 'g', path: 'Apple.md' },
  ]);
  assert.deepEqual(choices, [
    { value: noTemplateValue, label: 'No template' },
    { value: 'g', label: 'Apple' },
    { value: 'e', label: 'Day, in Templates' },
    { value: 'f', label: 'inbox' },
  ]);
  assert.equal(templateOfChoice(noTemplateValue), null);
  assert.equal(templateOfChoice('e'), 'e');
});

await test('the note of today opens only at a start on the note list', () => {
  assert.equal(
    opensTodayAtStart({
      openOnStart: true,
      startedOnNoteList: true,
      stillOnStart: true,
    }),
    true,
  );
  for (const input of [
    { openOnStart: false, startedOnNoteList: true, stillOnStart: true },
    { openOnStart: true, startedOnNoteList: false, stillOnStart: true },
    { openOnStart: true, startedOnNoteList: true, stillOnStart: false },
  ])
    assert.equal(opensTodayAtStart(input), false, JSON.stringify(input));
});

await test('a cached copy reads back as the settings it stored', () => {
  for (const settings of [
    { templateFileId: 'e', openOnStart: true, ...defaultDailyNoteLayout },
    {
      templateFileId: null,
      openOnStart: false,
      folder: '',
      format: 'YYYY/MM/DD',
    },
  ])
    assert.deepEqual(
      parseCachedSettings(formatCachedSettings(settings)),
      settings,
    );
  assert.equal(
    dailyNoteSettingsKey('account', 'workspace'),
    'notesapp.daily-notes:account:workspace',
  );
});

await test('a copy of another shape is no copy at all', () => {
  for (const source of [
    null,
    '',
    'not json',
    'null',
    '[]',
    '{"templateFileId":null}',
    '{"templateFileId":3,"openOnStart":true}',
    '{"templateFileId":null,"openOnStart":"yes"}',
    // A copy from before the layout settings holds no folder and no format.
    '{"templateFileId":null,"openOnStart":true}',
  ])
    assert.equal(parseCachedSettings(source), null, String(source));
});

await test('a refused template has its own sentence and every other failure keeps its own', () => {
  assert.equal(
    settingsProblem(404, 'general'),
    dailyNoteProblems.templateRefused,
  );
  assert.equal(settingsProblem(0, 'general'), dailyNoteProblems.offline);
  assert.equal(settingsProblem(500, 'server'), 'server');
});

await test('every sentence of a daily note problem names no code', () => {
  for (const sentence of Object.values(dailyNoteProblems)) {
    assert.match(sentence, /^[A-Z]/);
    assert.match(sentence, /\.$/);
    assert.doesNotMatch(sentence, /_|\d{3}/);
  }
});

await test('the note of a date follows the layout of the member', () => {
  const layout = { folder: 'Journal', format: 'YYYY/MM/YYYY-MM-DD dddd' };
  const shaped = [
    { fileId: 'j', path: 'Journal/2026/09/2026-09-25 Friday.md' },
    { fileId: 'k', path: 'Journal/2026/09/2026-09-03 Thursday.md' },
    // The note of the default layout is no daily note of this layout.
    { fileId: 'a', path: 'Daily notes/2026-09-24.md' },
  ];
  assert.equal(
    dailyNoteOf(shaped, { year: 2026, month: 9, day: 25 }, layout),
    'j',
  );
  assert.equal(
    dailyNoteOf(shaped, { year: 2026, month: 9, day: 24 }, layout),
    null,
  );
  assert.deepEqual(
    [...daysWithNotes(shaped, { year: 2026, month: 9 }, layout)].sort(
      (l, r) => l - r,
    ),
    [3, 25],
  );
  assert.equal(
    dailyNotePreview({ year: 2026, month: 9, day: 25 }, layout),
    'Journal/2026/09/2026-09-25 Friday',
  );
});

await test('every layout problem has its own sentence', () => {
  const sentences = Object.values(layoutProblemSentences);
  assert.equal(new Set(sentences).size, sentences.length);
  for (const sentence of sentences) assert.match(sentence, /\.$/);
});

await test('a typed folder is stored without a Save press, cleaned once', () => {
  assert.deepEqual(
    layoutToStore(
      { folder: ' /Journal/ ', format: 'YYYY-MM-DD' },
      defaultDailyNoteLayout,
    ),
    { folder: 'Journal', format: 'YYYY-MM-DD' },
  );
  assert.deepEqual(
    layoutToStore({ folder: '', format: 'YYYY-MM-DD' }, defaultDailyNoteLayout),
    { folder: '', format: 'YYYY-MM-DD' },
  );
});

await test('an unchanged or a broken layout is not stored', () => {
  assert.equal(
    layoutToStore(defaultDailyNoteLayout, defaultDailyNoteLayout),
    null,
  );
  assert.equal(
    layoutToStore(
      { folder: 'Daily notes/', format: 'YYYY-MM-DD' },
      defaultDailyNoteLayout,
    ),
    null,
  );
  assert.equal(
    layoutToStore(
      { folder: 'Journal', format: 'YYYY-MM' },
      defaultDailyNoteLayout,
    ),
    null,
  );
});

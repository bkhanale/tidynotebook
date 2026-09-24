/**
 * The daily notes of a workspace on this device.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dailyNoteOf,
  dailyNoteProblems,
  dailyNoteSettingsKey,
  daysWithNotes,
  effectiveTemplateId,
  formatCalendarOpen,
  formatCachedSettings,
  noTemplateValue,
  opensTodayAtStart,
  parseCachedSettings,
  parseCalendarOpen,
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
  assert.equal(dailyNoteOf(notes, { year: 2026, month: 9, day: 24 }), 'a');
  assert.equal(dailyNoteOf(notes, { year: 2026, month: 9, day: 25 }), null);
  // A note at another path is not the note of that date, even by its name.
  assert.equal(
    dailyNoteOf([{ fileId: 'x', path: 'Old/2026-09-24.md' }], {
      year: 2026,
      month: 9,
      day: 24,
    }),
    null,
  );
});

await test('the days of a month with a note are the days of its daily notes', () => {
  assert.deepEqual(
    [...daysWithNotes(notes, { year: 2026, month: 9 })].sort((l, r) => l - r),
    [3, 24],
  );
  assert.deepEqual([...daysWithNotes(notes, { year: 2026, month: 10 })], [1]);
  assert.deepEqual([...daysWithNotes(notes, { year: 2025, month: 9 })], []);
});

await test('a template counts while it is a live note of the list', () => {
  assert.equal(
    effectiveTemplateId({ templateFileId: 'e', openOnStart: false }, notes),
    'e',
  );
  // In Trash, or gone: the note is not in the list of live notes.
  assert.equal(
    effectiveTemplateId({ templateFileId: 'gone', openOnStart: false }, notes),
    null,
  );
  assert.equal(
    effectiveTemplateId({ templateFileId: null, openOnStart: true }, notes),
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
    { templateFileId: 'e', openOnStart: true },
    { templateFileId: null, openOnStart: false },
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

await test('the month shows unless the device stored that it is hidden', () => {
  assert.equal(parseCalendarOpen(null), true);
  assert.equal(parseCalendarOpen('something else'), true);
  assert.equal(parseCalendarOpen(formatCalendarOpen(true)), true);
  assert.equal(parseCalendarOpen(formatCalendarOpen(false)), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { historyDays, savedAtLabel } from './history-times.ts';

/** The clock of every case: English words on the clock of London. */
const clock = { locale: 'en-GB', timeZone: 'Europe/London' } as const;

/** The instant the cases read as now: Friday 2 October 2026, 15:00. */
const now = Date.parse('2026-10-02T14:00:00Z');

await test('two versions of one minute read as two times', () => {
  // Issue 254: both rows read "Saved just now".
  const days = historyDays(
    [
      { id: 'b', instant: '2026-10-02T13:32:41Z' },
      { id: 'a', instant: '2026-10-02T13:32:05Z' },
    ],
    now,
    clock,
  );
  assert.equal(days.length, 1);
  assert.equal(days[0]?.label, 'Today');
  assert.deepEqual(days[0]?.rows, [
    { id: 'b', time: '14:32:41' },
    { id: 'a', time: '14:32:05' },
  ]);
  const labels = days[0]?.rows.map((row) => savedAtLabel(row.time)) ?? [];
  assert.notEqual(labels[0], labels[1]);
});

await test('a version alone in its minute reads hours and minutes', () => {
  const days = historyDays(
    [
      { id: 'b', instant: '2026-10-02T13:40:00Z' },
      { id: 'a', instant: '2026-10-02T13:32:05Z' },
    ],
    now,
    clock,
  );
  assert.deepEqual(days[0]?.rows, [
    { id: 'b', time: '14:40' },
    { id: 'a', time: '14:32' },
  ]);
});

await test('the versions group by the day of the device, newest first', () => {
  const days = historyDays(
    [
      { id: 'c', instant: '2026-10-02T08:00:00Z' },
      { id: 'b', instant: '2026-10-01T20:00:00Z' },
      { id: 'a', instant: '2026-09-28T09:00:00Z' },
      { id: 'z', instant: '2025-12-24T09:00:00Z' },
    ],
    now,
    clock,
  );
  assert.deepEqual(
    days.map((day) => day.label),
    [
      'Today',
      'Yesterday',
      'Monday 28 September',
      'Wednesday, 24 December 2025',
    ],
  );
  assert.deepEqual(
    days.map((day) => day.rows.map((row) => row.id)),
    [['c'], ['b'], ['a'], ['z']],
  );
});

await test('the day follows the time zone and not the instant in UTC', () => {
  // 23:30 UTC on 1 October is 00:30 on 2 October in London.
  const days = historyDays(
    [{ id: 'a', instant: '2026-10-01T23:30:00Z' }],
    now,
    clock,
  );
  assert.equal(days[0]?.label, 'Today');
  assert.equal(days[0]?.rows[0]?.time, '00:30');
});

await test('yesterday holds across a change of the clock', () => {
  // The clocks of London go back on Sunday 25 October 2026.
  const monday = Date.parse('2026-10-26T09:00:00Z');
  const days = historyDays(
    [{ id: 'a', instant: '2026-10-25T00:30:00Z' }],
    monday,
    clock,
  );
  assert.equal(days[0]?.label, 'Yesterday');
});

await test('yesterday holds after the short day of the spring change', () => {
  // The review of the merged branch: the clocks of London go forward on
  // Sunday 29 March 2026, so that day is 23 hours long. At 00:30 on Monday,
  // 24 hours back is Saturday, and Sunday read as a date and not Yesterday.
  const monday = Date.parse('2026-03-29T23:30:00Z');
  const days = historyDays(
    [{ id: 'a', instant: '2026-03-29T12:00:00Z' }],
    monday,
    clock,
  );
  assert.equal(days[0]?.label, 'Yesterday');
});

await test('an instant that does not read gets no time and no error', () => {
  const days = historyDays([{ id: 'a', instant: 'not a time' }], now, clock);
  assert.deepEqual(days, [
    { key: 'unknown', label: 'Saved', rows: [{ id: 'a', time: '' }] },
  ]);
  assert.equal(savedAtLabel(''), 'Saved');
});

await test('a row reads Saved at its time', () => {
  assert.equal(savedAtLabel('14:32'), 'Saved at 14:32');
});

await test('every day has a key of its own', () => {
  const days = historyDays(
    [
      { id: 'c', instant: '2026-10-02T08:00:00Z' },
      { id: 'b', instant: 'broken' },
      { id: 'a', instant: '2026-10-02T07:00:00Z' },
    ],
    now,
    clock,
  );
  const keys = days.map((day) => day.key);
  assert.equal(new Set(keys).size, keys.length);
});

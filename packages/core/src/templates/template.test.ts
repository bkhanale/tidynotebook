/**
 * The placeholders of a template, for a daily note and for a template that a
 * person inserts (records 0102 and 0149).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isDateFormat } from '../dates/format.ts';
import { fillTemplate, templateVariableNames } from './template.ts';

/** The note of Thursday, 3 September 2026, filled at 07:30:15. */
const context = {
  date: { year: 2026, month: 9, day: 3 },
  time: { hour: 7, minute: 30, second: 15 },
  title: '2026-09-03 Thursday',
};

await test('the date and the title fill their placeholders', () => {
  assert.equal(fillTemplate('# {{date}}', context), '# 2026-09-03');
  assert.equal(
    fillTemplate('# {{date:dddd, Do MMMM YYYY}}', context),
    '# Thursday, 3rd September 2026',
  );
  assert.equal(fillTemplate('{{title}}', context), '2026-09-03 Thursday');
  // Space inside the braces and around the argument is allowed.
  assert.equal(fillTemplate('{{ date : DD.MM.YY }}', context), '03.09.26');
});

await test('a bare format of date tokens writes the date', () => {
  assert.equal(fillTemplate('{{YYYY-MM-DD}}', context), '2026-09-03');
  assert.equal(fillTemplate('{{dddd}}', context), 'Thursday');
  assert.equal(fillTemplate('{{[Week of] MMM D}}', context), 'Week of Sep 3');
});

await test('the date is the date of the note, not of the device', () => {
  assert.equal(
    fillTemplate('{{date}}', {
      ...context,
      date: { year: 2020, month: 1, day: 1 },
    }),
    '2020-01-01',
  );
});

await test('a placeholder that names nothing stays as it is', () => {
  for (const text of [
    '{{Monday}}',
    '{{name}}',
    '{{}}',
    '{{date:}}',
    '{{date:hello}}',
    '{{time:}}',
    '{{time:Monday}}',
    '{{ weather }}',
    '{single} braces',
    '{{unknown}}',
  ])
    assert.equal(fillTemplate(text, context), text, text);
});

await test('every placeholder of a text fills, and the rest stays', () => {
  const template = [
    '# {{date:dddd}}',
    '',
    '- [ ] Plan for {{date:D MMMM}}',
    '- Link: [yesterday](../{{YYYY}}.md)',
    '',
    '```',
    'code keeps {{literal}} braces',
    '```',
  ].join('\n');
  assert.equal(
    fillTemplate(template, context),
    [
      '# Thursday',
      '',
      '- [ ] Plan for 3 September',
      '- Link: [yesterday](../2026.md)',
      '',
      '```',
      'code keeps {{literal}} braces',
      '```',
    ].join('\n'),
  );
});

await test('a format holds only tokens, brackets and punctuation', () => {
  assert.equal(isDateFormat('YYYY-MM-DD'), true);
  assert.equal(isDateFormat('dddd'), true);
  assert.equal(isDateFormat('[Q]Q YYYY'), true);
  assert.equal(isDateFormat('Monday'), false);
  assert.equal(isDateFormat('Day YYYY'), false);
  assert.equal(isDateFormat('- / .'), false);
  assert.equal(isDateFormat(''), false);
});

await test('the time fills its placeholder in a format of its own', () => {
  assert.equal(fillTemplate('{{time}}', context), '07:30');
  assert.equal(fillTemplate('{{time:HH:mm:ss}}', context), '07:30:15');
  assert.equal(fillTemplate('{{ time : h:mm a }}', context), '7:30 am');
  // A date argument takes the time tokens too, as in Obsidian.
  assert.equal(
    fillTemplate('{{date:YYYY-MM-DD HH:mm}}', context),
    '2026-09-03 07:30',
  );
  // A time argument takes the date tokens too.
  assert.equal(
    fillTemplate('{{time:dddd [at] HH:mm}}', context),
    'Thursday at 07:30',
  );
});

await test('a bare placeholder never reads a time token', () => {
  // A short word made of time letters stays a word (record 0149).
  for (const text of ['{{had}}', '{{HH:mm}}', '{{mass}}', '{{a}}'])
    assert.equal(fillTemplate(text, context), text, text);
});

await test('a month and a year make one list for each month', () => {
  // The case of issue 220: one grocery list for each month.
  const template = '# Groceries, {{date:MMMM YYYY}}\n\n- [ ] Rice';
  assert.equal(
    fillTemplate(template, {
      ...context,
      date: { year: 2026, month: 10, day: 1 },
    }),
    '# Groceries, October 2026\n\n- [ ] Rice',
  );
});

await test('the variables are the date, the time and the title', () => {
  assert.deepEqual([...templateVariableNames].sort(), [
    'date',
    'time',
    'title',
  ]);
});

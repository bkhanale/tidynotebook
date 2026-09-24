/**
 * The placeholders of a daily note template.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isDateFormat } from './format.ts';
import { fillTemplate, templateVariableNames } from './template.ts';

/** The note of Thursday, 3 September 2026. */
const context = {
  date: { year: 2026, month: 9, day: 3 },
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

await test('the variables are the date and the title', () => {
  assert.deepEqual([...templateVariableNames].sort(), ['date', 'title']);
});

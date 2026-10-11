import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Meter } from '../dist/controls.js';

await test('a static meter states its role, range, value and accessible name', () => {
  const markup = renderToStaticMarkup(
    createElement(Meter, {
      label: 'Storage',
      value: 89,
      max: 100,
      text: '89 bytes of 100 bytes used',
    }),
  );
  for (const attribute of [
    'role="meter"',
    'aria-label="Storage"',
    'aria-valuemin="0"',
    'aria-valuemax="100"',
    'aria-valuenow="89"',
    'aria-valuetext="89 bytes of 100 bytes used"',
  ])
    assert.ok(markup.includes(attribute), attribute);
  assert.ok(markup.includes('89 bytes of 100 bytes used</p>'));
  assert.doesNotMatch(
    markup,
    /Almost full|bg-danger-fill|<script|\son[a-z]+=|\sstyle=/i,
  );
});

await test('a static meter states Almost full at the warning threshold', () => {
  const markup = renderToStaticMarkup(
    createElement(Meter, {
      label: 'Use',
      value: 90,
      max: 100,
      text: '90 of 100 used',
    }),
  );
  assert.ok(markup.includes('bg-danger-fill'));
  assert.ok(markup.includes('90 of 100 used. Almost full</p>'));
  assert.ok(markup.includes('aria-valuetext="90 of 100 used. Almost full"'));
});

await test('a meter above its maximum keeps the real use in words and a valid ARIA range', () => {
  const markup = renderToStaticMarkup(
    createElement(Meter, {
      label: 'Use',
      value: 125,
      max: 100,
      text: '125 of 100 used',
    }),
  );
  assert.ok(markup.includes('aria-valuenow="100"'));
  assert.ok(markup.includes('125 of 100 used. Almost full</p>'));
  assert.ok(markup.includes('w-full bg-danger-fill'));
});

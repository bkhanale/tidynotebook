/** The alert rule of a block quote, and the forms it refuses. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertMarkerLength,
  alertTitle,
  alertToneOf,
  alertTones,
} from './alerts.ts';
import { renderMarkdown } from './render.ts';

await test('every tone is read from its own marker', () => {
  for (const tone of alertTones)
    assert.equal(alertToneOf(`[!${tone.toUpperCase()}]\nBody.`), tone);
});

await test('a marker is read without regard to case', () => {
  assert.equal(alertToneOf('[!Note]\nBody.'), 'note');
  assert.equal(alertToneOf('[!tip]\nBody.'), 'tip');
});

await test('a marker alone is an alert with no body', () => {
  assert.equal(alertToneOf('[!NOTE]'), 'note');
  assert.equal(alertMarkerLength('[!NOTE]'), 7);
});

await test('the marker length covers the line break that follows it', () => {
  assert.equal(alertMarkerLength('[!NOTE]\nBody.'), 8);
  assert.equal(alertMarkerLength('[!NOTE]   \nBody.'), 11);
});

await test('a quote that opens with other text is no alert', () => {
  assert.equal(alertToneOf('A plain quote.'), null);
  assert.equal(alertToneOf('[!UNKNOWN]\nBody.'), null);
  assert.equal(alertToneOf('Text before [!NOTE]\nBody.'), null);
  assert.equal(alertToneOf('[!NOTE] on the same line'), null);
  assert.equal(alertMarkerLength('A plain quote.'), 0);
});

await test('the title of a tone is one word in sentence case', () => {
  assert.equal(alertTitle('note'), 'Note');
  assert.equal(alertTitle('important'), 'Important');
});

await test('each tone renders as a block quote that states its tone', async () => {
  for (const tone of alertTones) {
    const html = await renderMarkdown(
      `> [!${tone.toUpperCase()}]\n> The body of the alert.`,
    );
    assert.ok(
      html.startsWith(
        `<blockquote class="notes-alert" data-alert="${tone}"><p class="notes-alert-title">${alertTitle(tone)}</p>`,
      ),
      html,
    );
    assert.ok(html.includes('The body of the alert.'));
    assert.ok(!html.includes('[!'));
  }
});

await test('a quote that is no alert keeps every character', async () => {
  const html = await renderMarkdown('> [!UNKNOWN]\n> Body.');
  assert.ok(html.includes('[!UNKNOWN]'));
  assert.ok(html.startsWith('<blockquote>'));
});

await test('an alert marker cannot name a class of its own', async () => {
  // The tone reaches the page as one attribute of a fixed list, so a quote
  // can never carry a class that the schema did not name.
  const html = await renderMarkdown('> [!note]\n> Body.');
  assert.equal(html.match(/class="[^"]*"/g)?.length, 2);
  assert.ok(html.includes('class="notes-alert"'));
  assert.ok(html.includes('class="notes-alert-title"'));
});

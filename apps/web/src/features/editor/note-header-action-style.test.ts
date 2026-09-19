import assert from 'node:assert/strict';
import test from 'node:test';
import { buttonClassName } from '@notesapp/ui';
import { noteHeaderPublishButtonVariant } from './note-header-action-style.ts';

await test('the Publish header action is quiet until a person reaches it', () => {
  assert.equal(noteHeaderPublishButtonVariant, 'ghost');
  const classes = buttonClassName({
    variant: noteHeaderPublishButtonVariant,
  }).split(' ');
  assert.ok(classes.includes('bg-transparent'));
  assert.ok(classes.includes('hover:bg-hover'));
  assert.ok(!classes.includes('bg-card'));
  assert.ok(!classes.includes('shadow-raised'));
});

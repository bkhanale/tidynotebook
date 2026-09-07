import assert from 'node:assert/strict';
import test from 'node:test';
import {
  copyText,
  subscribeToSystemTheme,
  systemPrefersDark,
} from './platform.ts';

await test('optional browser capabilities have safe server fallbacks', async () => {
  assert.equal(await copyText('note'), false);
  assert.equal(systemPrefersDark(), false);
  assert.doesNotThrow(() => subscribeToSystemTheme(() => {})());
});

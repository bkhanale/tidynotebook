import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultThemeFor } from '@notesapp/ui';
import { emailPalettes } from '@notesapp/server';

await test('the email palette matches every copied Default theme token', () => {
  for (const appearance of ['light', 'dark'] as const) {
    const theme = defaultThemeFor(appearance);
    for (const [token, colour] of Object.entries(emailPalettes[appearance]))
      assert.equal(
        Reflect.get(theme.tokens, token),
        colour,
        `${appearance}: ${token}`,
      );
  }
});

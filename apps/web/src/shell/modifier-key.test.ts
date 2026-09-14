import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commandKey,
  controlKey,
  keyHintParts,
  modifierKeyOf,
  platformOf,
} from './modifier-key.ts';

await test('a Mac platform gets the Command key and its name', () => {
  for (const platform of ['macOS', 'MacIntel', 'iPad', 'iPhone']) {
    assert.equal(modifierKeyOf(platform), commandKey);
  }
  // The sign alone says nothing, so the key carries the word as well.
  assert.equal(commandKey.sign, '⌘');
  assert.equal(commandKey.name, 'Command');
});

await test('every other platform gets the Control key', () => {
  for (const platform of ['Win32', 'Windows', 'Linux x86_64', 'FreeBSD']) {
    assert.equal(modifierKeyOf(platform), controlKey);
  }
  assert.equal(controlKey.sign, 'Ctrl');
  assert.equal(controlKey.name, 'Control');
});

await test('an unknown platform falls back to the Control key', () => {
  assert.equal(modifierKeyOf(undefined), controlKey);
  assert.equal(modifierKeyOf(''), controlKey);
});

await test('the newer platform name wins over the old one', () => {
  const platform = platformOf({
    userAgentData: { platform: 'macOS' },
    platform: 'Win32',
  });
  assert.equal(platform, 'macOS');
  assert.equal(modifierKeyOf(platform), commandKey);
});

await test('the old platform name is read when the newer one is missing', () => {
  assert.equal(platformOf({ platform: 'Win32' }), 'Win32');
  assert.equal(
    platformOf({ userAgentData: {}, platform: 'MacIntel' }),
    'MacIntel',
  );
  assert.equal(
    platformOf({ userAgentData: { platform: '' }, platform: 'Win32' }),
    'Win32',
  );
});

await test('a render without a navigator reads no platform', () => {
  assert.equal(platformOf(undefined), undefined);
  assert.equal(platformOf(null), undefined);
  assert.equal(platformOf('macOS'), undefined);
  assert.equal(platformOf({}), undefined);
  assert.equal(platformOf({ platform: 7 }), undefined);
  assert.equal(platformOf({ platform: '' }), undefined);
});

await test('a key line keeps its text and marks the modifier key', () => {
  assert.deepEqual(keyHintParts('Cmd or Ctrl + S'), [
    { kind: 'modifier' },
    { kind: 'text', text: ' + S' },
  ]);
  assert.deepEqual(keyHintParts('Tab or Cmd or Ctrl + ]'), [
    { kind: 'text', text: 'Tab or ' },
    { kind: 'modifier' },
    { kind: 'text', text: ' + ]' },
  ]);
});

await test('a key line without the modifier key stays one piece of text', () => {
  assert.deepEqual(keyHintParts('Escape'), [{ kind: 'text', text: 'Escape' }]);
  assert.deepEqual(keyHintParts('Alt + Enter'), [
    { kind: 'text', text: 'Alt + Enter' },
  ]);
});

await test('every shortcut line of the dialog keeps all of its text', () => {
  // The hint must never lose a character of the line it shows.
  const lines = [
    'Cmd or Ctrl + Shift + X',
    'Shift + Tab or Cmd or Ctrl + [',
    'Cmd or Ctrl + 1 to 6',
    'Escape',
  ];
  for (const line of lines) {
    const rebuilt = keyHintParts(line)
      .map((part) => (part.kind === 'modifier' ? 'Cmd or Ctrl' : part.text))
      .join('');
    assert.equal(rebuilt, line);
  }
});

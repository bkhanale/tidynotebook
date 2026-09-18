import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commandKey,
  controlKey,
  isApplePlatform,
  keyCapOf,
  keyHintParts,
  modifierKeyOf,
  platformOf,
  type KeyHintPart,
} from './modifier-key.ts';

/** The signs of one key line, in order, for one kind of keyboard. */
function signs(keys: string, apple: boolean): string[] {
  return keyHintParts(keys, apple).map((part) =>
    part.kind === 'or' ? 'or' : part.cap.sign,
  );
}

/** The key names of one key line, in order. */
function names(keys: string, apple: boolean): string[] {
  return keyHintParts(keys, apple).map((part) =>
    part.kind === 'or' ? 'or' : part.cap.name,
  );
}

await test('a Mac platform gets the Command key and its name', () => {
  for (const platform of ['macOS', 'MacIntel', 'iPad', 'iPhone']) {
    assert.equal(modifierKeyOf(platform), commandKey);
    assert.ok(isApplePlatform(platform));
  }
  // The sign alone says nothing, so the key carries the word as well.
  assert.equal(commandKey.sign, '⌘');
  assert.equal(commandKey.name, 'Command');
});

await test('every other platform gets the Control key', () => {
  for (const platform of ['Win32', 'Windows', 'Linux x86_64', 'FreeBSD']) {
    assert.equal(modifierKeyOf(platform), controlKey);
    assert.ok(!isApplePlatform(platform));
  }
  assert.equal(controlKey.sign, 'Ctrl');
  assert.equal(controlKey.name, 'Control');
});

await test('an unknown platform falls back to the Control key', () => {
  assert.equal(modifierKeyOf(undefined), controlKey);
  assert.equal(modifierKeyOf(''), controlKey);
  assert.ok(!isApplePlatform(undefined));
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

await test('an Apple keyboard prints a sign on every modifier cap', () => {
  assert.deepEqual(keyCapOf('Shift', true), { sign: '⇧', name: 'Shift' });
  assert.deepEqual(keyCapOf('Alt', true), { sign: '⌥', name: 'Option' });
  assert.deepEqual(keyCapOf('Ctrl', true), { sign: '⌃', name: 'Control' });
});

await test('every other keyboard prints the word on the modifier cap', () => {
  assert.deepEqual(keyCapOf('Shift', false), { sign: 'Shift', name: 'Shift' });
  assert.deepEqual(keyCapOf('Alt', false), { sign: 'Alt', name: 'Alt' });
  assert.equal(keyCapOf('Ctrl', false), controlKey);
});

await test('a key that both keyboards print the same way has one cap', () => {
  for (const apple of [true, false]) {
    assert.deepEqual(keyCapOf('Enter', apple), { sign: '↵', name: 'Enter' });
    assert.deepEqual(keyCapOf('Escape', apple), {
      sign: 'Esc',
      name: 'Escape',
    });
  }
});

await test('a plain key is printed the way the table writes it', () => {
  for (const key of ['S', ']', 'Tab', '1 to 6']) {
    assert.deepEqual(keyCapOf(key, true), { sign: key, name: key });
    assert.deepEqual(keyCapOf(key, false), { sign: key, name: key });
  }
});

await test('one key line becomes one cap for each key', () => {
  assert.deepEqual(signs('Cmd or Ctrl + S', true), ['⌘', 'S']);
  assert.deepEqual(signs('Cmd or Ctrl + S', false), ['Ctrl', 'S']);
  assert.deepEqual(signs('Cmd or Ctrl + Shift + X', true), ['⌘', '⇧', 'X']);
  assert.deepEqual(names('Cmd or Ctrl + Shift + X', false), [
    'Control',
    'Shift',
    'X',
  ]);
});

await test('a line with one key is one cap', () => {
  assert.deepEqual(keyHintParts('Escape', false), [
    { kind: 'key', cap: { sign: 'Esc', name: 'Escape' } },
  ]);
});

await test('two key lines that run one command are joined by the word or', () => {
  // The defect this covers: the reader knew the modifier words alone, so a
  // line that offers two ways to indent a list item came out as one run of
  // text with a sign somewhere in it.
  assert.deepEqual(signs('Tab or Cmd or Ctrl + ]', false), [
    'Tab',
    'or',
    'Ctrl',
    ']',
  ]);
  assert.deepEqual(signs('Shift + Tab or Cmd or Ctrl + [', true), [
    '⇧',
    'Tab',
    'or',
    '⌘',
    '[',
  ]);
});

await test('a key range stays one cap', () => {
  assert.deepEqual(signs('Cmd or Ctrl + 1 to 6', true), ['⌘', '1 to 6']);
});

await test('every shortcut line of the dialog keeps all of its keys', () => {
  // The hint must never lose a key of the line it shows.
  const lines = [
    'Cmd or Ctrl + Shift + X',
    'Shift + Tab or Cmd or Ctrl + [',
    'Cmd or Ctrl + 1 to 6',
    'Alt + Enter',
    'Escape',
  ];
  for (const apple of [true, false]) {
    for (const line of lines) {
      const parts: readonly KeyHintPart[] = keyHintParts(line, apple);
      const rebuilt = parts
        .map((part) => (part.kind === 'or' ? 'or' : part.cap.name))
        .join(' ');
      for (const key of line
        .replaceAll('Cmd or Ctrl', apple ? 'Command' : 'Control')
        .split(/ \+ | or /))
        assert.ok(
          rebuilt.includes(key === 'Alt' && apple ? 'Option' : key),
          `${line} lost ${key}`,
        );
    }
  }
});

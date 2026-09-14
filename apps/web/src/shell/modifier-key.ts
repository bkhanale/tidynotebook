/**
 * The modifier key of this platform, and the parts of one key hint.
 *
 * macOS prints the Command sign on the key cap. Every other platform prints
 * the word Ctrl. A hint that names both platforms makes the person choose
 * one, so the application reads the platform one time, when this module
 * loads, and every hint then shows the key of the device.
 *
 * The platform cannot change while the page is open, so the read happens at
 * module scope and never during a render.
 *
 * `navigator.userAgentData` and `navigator.platform` are not in the standard
 * types, so a type guard reads them. A render without a navigator, and a
 * platform that no guard knows, both fall back to Ctrl.
 *
 * `Command` and `Ctrl` are key names, so they keep their own case.
 */

/** One modifier key: the sign on the key cap, and the name of the key. */
export type ModifierKey = {
  /** The sign that the key cap of this platform shows. */
  readonly sign: string;
  /** The full key name, which a screen reader reads. */
  readonly name: string;
};

/** The Command key of macOS. U+2318 is the sign on its key cap. */
export const commandKey: ModifierKey = { sign: '⌘', name: 'Command' };

/** The Control key of every other platform. */
export const controlKey: ModifierKey = { sign: 'Ctrl', name: 'Control' };

/** The platform names that carry a Command key. */
const macPlatform = /mac|iphone|ipad|ipod/i;

/** Tells if a value holds a `platform` string. */
function hasPlatform(value: unknown): value is { readonly platform: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'platform' in value &&
    typeof value.platform === 'string'
  );
}

/**
 * Reads the platform name of one navigator, or `undefined` when it has none.
 *
 * The newer `userAgentData.platform` wins, because `navigator.platform` is
 * old and some browsers freeze its value.
 */
export function platformOf(source: unknown): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const agentData: unknown =
    'userAgentData' in source ? source.userAgentData : undefined;
  if (hasPlatform(agentData) && agentData.platform !== '')
    return agentData.platform;
  if (hasPlatform(source) && source.platform !== '') return source.platform;
  return undefined;
}

/** Picks the modifier key of one platform name. */
export function modifierKeyOf(platform: string | undefined): ModifierKey {
  if (platform === undefined) return controlKey;
  return macPlatform.test(platform) ? commandKey : controlKey;
}

/** The modifier key of this device. */
export const modifierKey: ModifierKey = modifierKeyOf(
  platformOf(typeof navigator === 'undefined' ? undefined : navigator),
);

/** The words that the shortcut table writes where the modifier key belongs. */
export const modifierKeyWords = 'Cmd or Ctrl';

/** One part of a key hint: a piece of text, or the modifier key itself. */
export type KeyHintPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'modifier' };

/**
 * Cuts one key line into the parts that a hint shows.
 *
 * The shortcut table in `packages/editor` names both platforms in one
 * string, because it is the one truth for the key maps and for the dialog.
 * A hint shows one key, so this reader puts a modifier part where those
 * words are and keeps the rest of the line as it is.
 */
export function keyHintParts(keys: string): readonly KeyHintPart[] {
  const parts: KeyHintPart[] = [];
  const pieces = keys.split(modifierKeyWords);
  for (const [index, text] of pieces.entries()) {
    if (index > 0) parts.push({ kind: 'modifier' });
    if (text !== '') parts.push({ kind: 'text', text });
  }
  return parts;
}

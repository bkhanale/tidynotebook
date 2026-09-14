/**
 * The one key hint of the application.
 *
 * Every place that shows a key uses this piece, so the platform decision is
 * made one time in `modifier-key.ts` and no screen repeats it.
 *
 * The Command sign is a picture. A screen reader says nothing useful about
 * it, and `Ctrl` is a short form of a word. So the hint hides the sign from
 * the accessibility tree and puts the full key name next to it, where a
 * screen reader reads it as text. `kbd` is the native element for a key, and
 * the HTML rule for a key combination is a `kbd` inside a `kbd`, so the
 * modifier key is its own element inside the hint.
 */
import { Fragment, type ReactNode } from 'react';
import { keyHintParts, modifierKey } from './modifier-key.ts';

/** The modifier key of this platform, with its name for a screen reader. */
export function ModifierKeyHint(): ReactNode {
  return (
    <kbd>
      <span aria-hidden="true">{modifierKey.sign}</span>
      <span className="sr-only">{modifierKey.name}</span>
    </kbd>
  );
}

/** One key line, with the modifier key of this platform inside it. */
export function KeyHint({ keys }: { readonly keys: string }): ReactNode {
  return (
    <>
      {keyHintParts(keys).map((part, index) => (
        <Fragment key={`${String(index)}:${part.kind}`}>
          {part.kind === 'modifier' ? <ModifierKeyHint /> : part.text}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The words and the time of a copy action (record 0174).
 *
 * A code block of the editor and of a published page copies its code with one
 * control. Both read the words here, so the action has one name on every
 * surface, and the confirmation stays on the screen for one time.
 *
 * The control has three states. It is ready to copy, it copied, or the
 * browser refused the copy and the control selected the code instead, so the
 * person copies it with the keys of the device. That is the one way a copy
 * fails. The visible word, the accessible name and what a person hears follow
 * the state, and the name says which code the control copies.
 */

/** The state of one copy control. */
export type CopyState = 'ready' | 'copied' | 'selected';

/** The words of a copy control in each state. */
export const copyCodeWords = {
  ready: 'Copy',
  copied: 'Copied',
  selected: 'Selected',
} as const satisfies Readonly<Record<CopyState, string>>;

/** What a person hears when a copy control changes its state. */
const copyAnnouncements = {
  ready: '',
  copied: 'The code is on the clipboard.',
  selected:
    'The browser did not copy the code. The code is selected, so you can copy it with the keyboard.',
} as const satisfies Readonly<Record<CopyState, string>>;

/** What one copy control shows, says and announces. */
export type CopyControlWords = {
  /** The visible word of the control. */
  readonly word: string;
  /**
   * The accessible name, which starts with the visible word (WCAG 2.5.3) and
   * names the language of the block, so two bars of a note differ.
   */
  readonly name: string;
  /** What a person hears when the control takes this state, or nothing. */
  readonly announcement: string;
};

/**
 * The words of the copy control of one block in one state.
 *
 * `label` is the label of the block, as `codeBlockLabel` of
 * `@notesapp/markdown` names it, or `null` for a block with no label.
 */
export function copyControlWords(
  state: CopyState,
  label: string | null,
): CopyControlWords {
  const word = copyCodeWords[state];
  const code = label === null || label === '' ? 'code' : `${label} code`;
  return {
    word,
    name: `${word} ${code}`,
    announcement: copyAnnouncements[state],
  };
}

/** How long a copy control states that it copied, in milliseconds. */
export const copiedForMs = 2000;

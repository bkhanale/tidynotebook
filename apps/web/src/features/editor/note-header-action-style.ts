/**
 * The style of the actions that the note route puts in the frame header.
 *
 * A header action is quiet at rest. The route name is the context of the
 * screen, and an action gains a fill only when a pointer or the keyboard
 * reaches it. This rule stays outside JSX so a unit test can hold it.
 */
import type { ButtonVariant } from '@notesapp/ui';

/** The Publish action in the frame header. */
export const noteHeaderPublishButtonVariant: ButtonVariant = 'ghost';

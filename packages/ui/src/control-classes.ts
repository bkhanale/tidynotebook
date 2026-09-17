/**
 * The class rules of a control, as pure functions.
 *
 * A control in `controls.tsx` is JSX, so no unit test can load it. The rules
 * that decide how a control looks are not JSX, and they are the part a rule of
 * this repository holds: the named scale, the palette, and the ban on making a
 * colour at paint time. They live here so `control-classes.test.ts` can read
 * them, and `controls.tsx` renders with them.
 */
import { transitionSurface } from './motion.ts';

/** How a button looks. */
export type ButtonVariant =
  'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';

/** How large a button is. */
export type ButtonSize = 'sm' | 'md';

/**
 * The appearance of a button, as classes.
 *
 * A control that navigates is an anchor and never a button, so the platform
 * keeps the middle click, the context menu, and the address. The router of
 * the application owns that anchor, so this function hands out the same
 * appearance to it and every action button of a screen looks the same.
 *
 * A filled button reads its hover fill from the palette (decision 0057). The
 * registry moves that fill away from the page background, so the control comes
 * forward on a light palette and on a dark one, and the contrast test holds
 * the label of the fill on it.
 */
export function buttonClassName(
  options: {
    readonly variant?: ButtonVariant | undefined;
    readonly size?: ButtonSize | undefined;
    readonly className?: string | undefined;
  } = {},
): string {
  const variant = options.variant ?? 'primary';
  const size = options.size ?? 'md';
  const variantClass =
    variant === 'secondary'
      ? 'border-edge bg-transparent text-strong hover:bg-hover'
      : variant === 'danger'
        ? 'border-danger-fill bg-danger-fill text-on-danger hover:border-danger-fill-hover hover:bg-danger-fill-hover'
        : variant === 'ghost'
          ? 'border-transparent bg-transparent text-strong hover:bg-hover'
          : variant === 'subtle'
            ? 'border-edge-subtle bg-hover text-strong hover:bg-active'
            : 'border-accent-fill bg-accent-fill text-on-accent shadow-raised hover:border-accent-fill-hover hover:bg-accent-fill-hover';

  // Touch pointers get the 44 px minimum. A mouse pointer keeps the compact
  // control scale, so the chrome stays quiet on a desktop screen.
  const sizeClass =
    size === 'sm' ? 'min-h-11 px-2.5 md:min-h-8' : 'min-h-11 px-3 md:min-h-9';
  return [
    `inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border py-1.5 text-control font-medium no-underline ${transitionSurface} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50`,
    variantClass,
    sizeClass,
    options.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Which state a badge reports. */
export type BadgeTone = 'default' | 'accent' | 'success' | 'danger';

/**
 * The appearance of a badge, as classes.
 *
 * Every tone sits on the hover surface, which is one of the five fills that
 * the contrast test holds the accent, success and danger text to. A fill that
 * a screen mixes from the tone itself moves with its own label, so the two
 * close on each other and the label loses its minimum (decision 0057). The
 * tone stays in the text and in the edge, which carries no text.
 */
export function badgeClassName(tone: BadgeTone): string {
  const toneClass =
    tone === 'accent'
      ? 'border-accent/30 bg-hover text-accent'
      : tone === 'success'
        ? 'border-success/30 bg-hover text-success'
        : tone === 'danger'
          ? 'border-danger/30 bg-hover text-danger'
          : 'border-edge-subtle bg-hover text-muted';
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-control font-semibold ${toneClass}`;
}

/**
 * The one recipe of every control, as pure functions.
 *
 * A control in `controls.tsx` is JSX, so no unit test can load it. The rules
 * that decide how a control looks, and how it names itself to a person who
 * cannot see it, are not JSX, and they are the part a rule of this repository
 * holds: the named scale, the palette, the ban on making a colour at paint
 * time, and the accessible name of every action. They live here so
 * `control-classes.test.ts` can read them, and every control of the product
 * renders with them.
 *
 * Nothing outside this module writes the classes of a button, a clickable
 * row, a field or a keyboard hint. See
 * [decision 0065](../../../docs/decisions/0065-one-recipe-for-a-control-and-one-grid-for-an-icon.md).
 */
import { transitionField, transitionSurface } from './motion.ts';

/**
 * The focus treatment of a control with room around it.
 *
 * One treatment for the whole product: two pixels of the focus colour, which
 * `theme.test.ts` holds to the 3 to 1 non text minimum on every surface. The
 * outline sits outside the control, so it never covers the label.
 *
 * `focus-visible` and never `focus`, so a pointer press does not leave a ring
 * behind on a control a person already clicked.
 */
export const focusOutline =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * The focus treatment of a control inside a box that scrolls.
 *
 * The same two pixels, drawn inside the edge of the control. A tree row, a
 * menu row and a list row sit in a box that clips its children, and an
 * outline offset outward is the part that box cuts off first.
 */
export const focusOutlineInset =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus';

/** How a button looks. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** How large a button is. */
export type ButtonSize = 'sm' | 'md';

/**
 * The tone of a quiet button.
 *
 * `danger` marks a ghost or a secondary button that starts a destructive
 * action, such as Delete on a Trash row, before the filled
 * `danger` variant confirms it. The tone is part of the recipe and never a
 * class a caller adds, because two colour utilities on one element are decided
 * by the stylesheet and not by the caller (decision 0065).
 */
export type ButtonTone = 'danger';

/** The colour and surface of one button. */
function buttonVariantClassName(
  variant: ButtonVariant,
  tone: ButtonTone | undefined,
  interaction: 'button' | 'group',
): string {
  const danger = tone === 'danger';
  const hover = interaction === 'group' ? 'group-hover:' : 'hover:';
  return variant === 'secondary'
    ? danger
      ? `border border-edge-line bg-card text-danger shadow-raised ${hover}bg-danger-surface`
      : `border border-edge-line bg-card text-strong shadow-raised ${hover}bg-hover`
    : variant === 'ghost'
      ? danger
        ? `bg-transparent text-danger ${hover}bg-danger-surface`
        : `bg-transparent text-strong ${hover}bg-hover`
      : variant === 'danger'
        ? `bg-danger-fill text-on-danger ${hover}bg-danger-fill-hover`
        : `bg-accent-fill text-on-accent ${hover}bg-accent-fill-hover`;
}

/**
 * The appearance of a button, as classes.
 *
 * A control that navigates is an anchor and never a button, so the platform
 * keeps the middle click, the context menu, and the address. The router of
 * the application owns that anchor, so this function hands out the same
 * appearance to it and every action button of a screen looks the same.
 *
 * `primary` is the one action of a screen. `secondary` is every other button:
 * the card fill, the resting divider as its edge (decision 0063) and one
 * elevation step, so a light palette shows the shadow and a dark palette
 * shows the edge. `ghost` is an icon only action and a Cancel, and it draws
 * nothing until a pointer or the keyboard reaches it. `danger` confirms a
 * destructive action.
 *
 * A filled button reads its hover fill from the palette (decision 0057). The
 * registry moves that fill away from the page background, so the control comes
 * forward on a light palette and on a dark one, and the contrast test holds
 * the label of the fill on it. Nothing scales on press: a control that moves
 * under the pointer moves the target a person is aiming at.
 */
export function buttonClassName(
  options: {
    readonly variant?: ButtonVariant | undefined;
    readonly size?: ButtonSize | undefined;
    readonly tone?: ButtonTone | undefined;
    readonly iconOnly?: boolean | undefined;
    readonly compact?: boolean | undefined;
    readonly className?: string | undefined;
  } = {},
): string {
  const variant = options.variant ?? 'primary';
  const size = options.size ?? 'md';
  const compact = options.compact === true;
  const variantClass = compact
    ? 'group bg-transparent'
    : buttonVariantClassName(variant, options.tone, 'button');

  // Touch pointers get the 44 px minimum. A mouse pointer keeps the compact
  // control scale, so the chrome stays quiet on a desktop screen: 32 px for a
  // button and 28 px for a small one.
  const sizeClass = options.iconOnly
    ? size === 'sm'
      ? 'size-11 px-0 md:size-7'
      : 'size-11 px-0 md:size-8'
    : compact
      ? size === 'sm'
        ? 'min-h-11 px-0 md:min-h-7'
        : 'min-h-11 px-0 md:min-h-8'
      : size === 'sm'
        ? 'min-h-11 px-2.5 md:min-h-7'
        : 'min-h-11 px-3 md:min-h-8';
  return [
    `inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-control font-medium no-underline ${transitionSurface} ${compact ? 'focus-visible:outline-none' : focusOutline} disabled:cursor-not-allowed disabled:opacity-50`,
    variantClass,
    sizeClass,
    options.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The visible surface inside a compact button.
 *
 * The button keeps its 44 px touch target. A small surface is 32 px under
 * touch and 28 px on a desktop. It takes the focus treatment, fill, and hover
 * state that a person sees. An icon-only surface stays square.
 */
export function compactButtonVisualClassName(options: {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly tone?: ButtonTone | undefined;
  readonly iconOnly: boolean;
}): string {
  const variant = options.variant ?? 'primary';
  const size = options.size ?? 'md';
  const sizeClass = options.iconOnly
    ? size === 'sm'
      ? 'size-8 md:size-7'
      : 'size-9 md:size-8'
    : size === 'sm'
      ? 'min-h-8 px-2.5 md:min-h-7'
      : 'min-h-9 px-3 md:min-h-8';
  return [
    `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md ${transitionSurface}`,
    'group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus',
    buttonVariantClassName(variant, options.tone, 'group'),
    sizeClass,
  ].join(' ');
}

/**
 * The appearance of a clickable row, as classes.
 *
 * One recipe for every row a person can press: a tree row, a list row, a menu
 * row, a row of the command palette and a footer row of the sidebar. A row is
 * 28 px on a desktop and 44 px under touch, it separates from its neighbour
 * by space and by fill and never by a rule, and it takes no ring.
 *
 * `selected` is the choice a person made, for example the folder that a new
 * note goes into. `current` is the route that is open, which a row states to
 * assistive software with `aria-current`. Both read as one mark, because a
 * person reads one list and needs one answer to "which row is mine".
 *
 * `inset` is true by default, because almost every row of the product sits in
 * a box that scrolls and clips. A row that stands on its own passes false and
 * takes the outward outline of every other control.
 *
 * `interactive` is true by default. A row that is only a container, with the
 * actions inside it, passes false: it keeps the size, the radius and the
 * spacing of a row and drops the pointer, the hover and the focus treatment,
 * so the cursor never promises an action the row does not have.
 *
 * `danger` is a row that destroys something, such as Delete in a menu, or a
 * row that reports work a person has to rescue. The tone is part of the
 * recipe and not a class a caller adds, because two colour utilities on one
 * element are decided by the order of the stylesheet and not by the order of
 * the string: `text-danger` appended to this recipe lost to the `text-ink` of
 * the recipe itself, so every Delete row of the product was the colour of
 * every other row.
 */
export function rowClassName(
  options: {
    readonly selected?: boolean | undefined;
    readonly current?: boolean | undefined;
    readonly inset?: boolean | undefined;
    readonly interactive?: boolean | undefined;
    readonly danger?: boolean | undefined;
    readonly className?: string | undefined;
  } = {},
): string {
  const marked = options.selected === true || options.current === true;
  const interactive = options.interactive ?? true;
  // A row with a tone keeps that tone in every state, so the mark and the
  // hover of a toned row change the fill alone. One colour utility for one
  // element, because two of them are decided by the order of the stylesheet
  // and not by the order of the string.
  const toned = options.danger === true;
  const colour = toned ? 'text-danger' : 'text-ink';
  const state = marked
    ? toned
      ? 'bg-active font-medium'
      : 'bg-active text-strong font-medium'
    : interactive
      ? toned
        ? 'hover:bg-hover'
        : 'hover:bg-hover hover:text-strong'
      : '';
  return [
    `flex min-h-11 items-center gap-2 rounded-md px-2 text-control ${colour} no-underline ${transitionSurface} md:min-h-7`,
    interactive ? 'cursor-pointer' : '',
    interactive
      ? options.inset === false
        ? focusOutline
        : focusOutlineInset
      : '',
    state,
    options.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The appearance of a field, as classes.
 *
 * A text field, a select and a read only field all read this, so the three
 * copies of one field are one field. The resting edge is the derived divider
 * (decision 0063): a field is identified by its label above it, by its fill
 * and by the ring it takes when it is active, and the component edge on a
 * field read as a cage around every form of the product. Record 0063 states
 * the trade, so nobody reports it as a defect.
 *
 * The active state is the focus colour on the edge and a ring at a quarter of
 * its strength. `focus-visible` carries it, not `focus`: a browser always
 * matches `:focus-visible` on a control a person types into, however the
 * focus arrived, so one prefix covers the whole product and a pointer press
 * on a button still leaves no ring behind.
 *
 * `invalid` is the error state, and it is the one other edge a field changes.
 */
export function fieldClassName(
  options: {
    readonly invalid?: boolean | undefined;
    readonly className?: string | undefined;
  } = {},
): string {
  return [
    `w-full min-h-11 rounded-md border bg-app px-3 text-ui text-strong outline-none ${transitionField} focus-visible:ring-2 focus-visible:ring-focus/25 md:min-h-8`,
    options.invalid === true
      ? 'border-danger'
      : 'border-edge-line focus-visible:border-focus',
    options.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The appearance of one key cap of a keyboard hint, as classes.
 *
 * A hint is the quietest text of the product, so it has a named step of its
 * own, `text-kbd`, and it is set in the code face because a key name is a
 * value and not prose. One cap holds one key; a combination is one cap for
 * each key.
 */
export function kbdClassName(): string {
  return 'inline-flex items-center rounded-sm border border-edge-line bg-surface px-1.5 font-mono text-kbd text-muted';
}

/**
 * The appearance of a badge, as classes.
 *
 * A badge states one fact about the row it sits on, for example that a note
 * exists on this device alone. It is not a tone: a fill that a screen mixes
 * from a tone moves with its own label, so the two close on each other and
 * the label loses its minimum (decision 0057). The badge therefore takes the
 * hover surface, which the contrast test holds the muted text to, and it
 * states its meaning in its word.
 */
export function badgeClassName(): string {
  return 'inline-flex items-center rounded-sm bg-hover px-1.5 text-kbd font-medium text-muted';
}

/** The accessible name and the tooltip of one button. */
export type ButtonName = {
  readonly ariaLabel: string | undefined;
  readonly title: string | undefined;
};

/**
 * How a button names itself.
 *
 * A `label` names the button whether or not the button also shows text. One
 * word on a row of a list, such as `Restore` or `Delete`, names
 * the action and never the row it acts on, so every row of that list carried
 * the same name while a label given to a button with text was dropped.
 *
 * WCAG 2.5.3 Label in Name still holds, and the caller holds it: a label for
 * a button that also shows text starts with that exact text, so speech input
 * reaches the control by the words a person reads on it.
 *
 * A tooltip belongs to an icon-only button alone. A button with visible text
 * already states its purpose on the screen, so a tooltip there repeats it. An
 * explicit `title` wins, because a caller can have a reason for one.
 */
export function buttonName(options: {
  readonly label?: string | undefined;
  readonly title?: string | undefined;
  readonly hasText: boolean;
}): ButtonName {
  return {
    ariaLabel: options.label,
    title: options.title ?? (options.hasText ? undefined : options.label),
  };
}

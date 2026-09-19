/**
 * A menu button with full keyboard support.
 *
 * The trigger owns `aria-haspopup` and `aria-expanded`. The open menu takes
 * focus, moves it with the arrow keys, Home, and End, activates an item with
 * Enter or Space, and closes on Escape, on a pointer press outside, and
 * after an item runs. Focus always returns to the trigger.
 *
 * Every class the menu renders comes from `./control-classes.ts`: the trigger
 * is a ghost button and each row is `rowClassName` (decision 0065). A
 * `compact` trigger keeps its touch target and draws a smaller surface inside
 * it, exactly as a compact `Button` does, so a menu in a row of actions or in
 * the frame header stays as quiet as every other control. The
 * surface is a raised plane: the card fill, the subtle edge and the overlay
 * step (decisions 0052 and 0063). `hint` is the quiet value on the right of a
 * row, such as the theme that is in force; a keyboard hint is a key cap from
 * `kbdClassName` and the screen that owns the keys draws it.
 *
 * The list is put at the end of the document and placed on the screen, not
 * laid out beside the trigger. A trigger can stand in a box that scrolls, and
 * a box that scrolls on one axis clips on both, so a list laid out inside it
 * loses every row that reaches past its edge. The row actions of the folder
 * tree are the case that proves it: a row near the foot of the tree showed
 * one of its five actions, and a row deep in a narrow sidebar lost its left
 * edge. `./overlay-position.ts` decides the place and this file is the one
 * that writes it. See
 * [decision 0058](../../../docs/decisions/0058-an-overlay-is-placed-on-the-screen.md).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  buttonClassName,
  compactButtonVisualClassName,
  rowClassName,
} from './control-classes.ts';
import { transitionRaise } from './motion.ts';
import { placeOverlay } from './overlay-position.ts';

/** One row of a menu. */
export type MenuItem = {
  /** A value that is unique inside one menu. */
  readonly id: string;
  readonly label: string;
  /** A short value shown on the right, such as the current theme. */
  readonly hint?: string | undefined;
  readonly icon?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  /** Draws the row with the danger token. */
  readonly danger?: boolean | undefined;
  /**
   * Marks the row as the one in force, for a menu that chooses between
   * alternatives rather than running actions.
   *
   * A menu that sets this on any row states the choice to assistive software:
   * the marked row carries `menuitemradio` and `aria-checked`, so a person
   * hears which one is open before they move off it.
   */
  readonly selected?: boolean | undefined;
  readonly onSelect: () => void;
};

/** Where the menu opens relative to its trigger. */
export type MenuAlign = 'start' | 'end';

/** One row of an open menu, in either region. */
function MenuRow({
  item,
  choosing,
  onRun,
}: {
  readonly item: MenuItem;
  /** True when any row of this menu states a selection. */
  readonly choosing: boolean;
  readonly onRun: (item: MenuItem) => void;
}): ReactNode {
  return (
    <button
      type="button"
      role={choosing ? 'menuitemradio' : 'menuitem'}
      aria-checked={choosing ? item.selected === true : undefined}
      tabIndex={-1}
      className={rowClassName({
        selected: item.selected,
        danger: item.danger,
        className:
          'w-full text-left disabled:cursor-not-allowed disabled:opacity-50 md:min-h-8',
      })}
      disabled={item.disabled ?? false}
      onClick={() => onRun(item)}
    >
      {item.icon === undefined ? null : (
        <span className="inline-flex shrink-0 items-center" aria-hidden="true">
          {item.icon}
        </span>
      )}
      <span className="flex-1 truncate">{item.label}</span>
      {item.hint === undefined ? null : (
        <span className="shrink-0 text-control text-muted">{item.hint}</span>
      )}
    </button>
  );
}

/** A button that opens one menu of actions. */
export function Menu({
  label,
  icon,
  items,
  pinned = [],
  matchTrigger = false,
  align = 'end',
  triggerClassName,
  compact = false,
  children,
}: {
  /** The accessible name of the trigger. */
  readonly label: string;
  readonly icon?: ReactNode | undefined;
  readonly items: readonly MenuItem[];
  /**
   * Rows that stay in view while `items` scrolls.
   *
   * A list that can grow without bound, such as the workspaces of an account,
   * takes its create action here, so the action does not walk off the bottom
   * of the menu as the list fills. A pinned row is last in the keyboard order,
   * because it is last on the screen.
   */
  readonly pinned?: readonly MenuItem[] | undefined;
  /**
   * Opens the menu at the width of its trigger.
   *
   * A trigger that fills its column, such as the workspace switcher, reads as
   * one control with the list it opens. A menu narrower than its own trigger
   * lines up with neither edge and looks like a mistake.
   */
  readonly matchTrigger?: boolean | undefined;
  readonly align?: MenuAlign | undefined;
  readonly triggerClassName?: string | undefined;
  /**
   * Keeps the touch target of the trigger and draws a smaller surface inside
   * it, the way a compact `Button` does.
   *
   * A compact trigger is a quiet icon-only control, so the surface reads the
   * ghost recipe at the small size. The trigger stays as easy to hit under
   * touch, and the mark a person sees is the one the rest of the product
   * draws.
   */
  readonly compact?: boolean | undefined;
  /** Visible trigger text. Omit it for an icon-only trigger. */
  readonly children?: ReactNode | undefined;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The arrow keys run over both regions in the order they are on the screen,
  // so a pinned row is reached by pressing End and never disappears from the
  // keyboard order when the scrolling list grows.
  const enabled = [...items, ...pinned].filter(
    (item) => item.disabled !== true,
  );

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // The list is not a child of the trigger in the document, so a press
      // inside it has to be read against both.
      if (rootRef.current?.contains(target) === true) return;
      if (listRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      listRef.current
        ?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])',
        )
        [activeIndex]?.focus();
    });
    // The effect runs for the open state and for every move of the cursor.
  }, [open, activeIndex]);

  /**
   * Writes the place of the open list.
   *
   * The height bound of the last placement is cleared first, so the list
   * reports the height it wants and not the height it was given. Nothing else
   * about the list is written here: its colour, its edge, its radius, its
   * padding and its depth all stay in the named scales.
   */
  const place = useCallback((): void => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (trigger === null || list === null) return;
    list.style.maxHeight = '';
    const anchor = trigger.getBoundingClientRect();
    if (matchTrigger) list.style.width = `${String(anchor.width)}px`;
    const size = list.getBoundingClientRect();
    const spot = placeOverlay({
      anchor: {
        top: anchor.top,
        left: anchor.left,
        width: anchor.width,
        height: anchor.height,
      },
      overlay: { width: size.width, height: size.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      align,
    });
    list.style.top = `${String(spot.top)}px`;
    list.style.left = `${String(spot.left)}px`;
    list.style.maxHeight = `${String(spot.maxHeight)}px`;
  }, [align, matchTrigger]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const follow = (): void => {
      place();
    };
    window.addEventListener('resize', follow);
    // The capture phase, because the trigger can sit in a box that scrolls,
    // such as the folder tree, and a scroll there does not reach the window.
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, place]);

  const move = (delta: number): void => {
    setActiveIndex((current) => {
      const count = enabled.length;
      if (count === 0) return 0;
      return (current + delta + count) % count;
    });
  };

  const menuId = `${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-menu`;
  // A menu states a selection only when a row claims one, so every menu that
  // runs actions keeps the plain `menuitem` role it had.
  const choosing = [...items, ...pinned].some(
    (item) => item.selected !== undefined,
  );

  const run = (item: MenuItem): void => {
    close(true);
    item.onSelect();
  };

  const triggerContent = (
    <>
      {icon === undefined ? null : (
        <span
          className="inline-flex items-center justify-center"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      {children === undefined ? null : (
        // A flex box and not a plain span, because a trigger that shows text
        // often shows more than text: an icon, a label that has to take the
        // free width, and a chevron at the far edge. A plain span made those
        // three one inline box, so the parts could not be laid out at all.
        <span className="flex min-w-0 flex-1 items-center gap-cluster">
          {children}
        </span>
      )}
    </>
  );

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={
          triggerClassName ??
          buttonClassName({
            variant: 'ghost',
            size: compact ? 'sm' : 'md',
            iconOnly: children === undefined,
            compact,
          })
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // `label` names the trigger whether or not it also shows text, because
        // visible text says what the menu is about and not what the control
        // does. A trigger reading `Personal` is a workspace name; its name has
        // to say that it opens the workspace menu. The visible text stays
        // inside the name, so speech input still reaches it.
        aria-label={label}
        // A trigger with visible text needs no tooltip. An icon-only one does,
        // because nothing else on the screen states its purpose.
        title={children === undefined ? label : undefined}
        onClick={() => {
          setActiveIndex(0);
          setOpen((value) => !value);
        }}
        onKeyDown={(event): void => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(event.key === 'ArrowDown' ? 0 : enabled.length - 1);
            setOpen(true);
          }
        }}
      >
        {compact ? (
          <span
            className={compactButtonVisualClassName({
              variant: 'ghost',
              size: 'sm',
              iconOnly: children === undefined,
            })}
          >
            {triggerContent}
          </span>
        ) : (
          triggerContent
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={listRef}
              id={menuId}
              className={`fixed z-50 flex flex-col rounded-lg border border-edge-subtle bg-card p-1 shadow-overlay ${transitionRaise} ${matchTrigger ? '' : 'min-w-56'}`}
              role="menu"
              aria-label={label}
              onKeyDown={(event): void => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  // Escape closes the innermost thing and nothing above it. An
                  // open menu inside the navigation drawer would otherwise
                  // close the drawer as well, because the drawer listens for
                  // the key on the window, and focus would have nowhere to
                  // return to.
                  event.stopPropagation();
                  close(true);
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  setActiveIndex(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  setActiveIndex(Math.max(enabled.length - 1, 0));
                } else if (event.key === 'Tab') {
                  event.preventDefault();
                  close(true);
                }
              }}
            >
              <div className="min-h-0 flex-1 overflow-y-auto">
                {items.map((item) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    choosing={choosing}
                    onRun={run}
                  />
                ))}
              </div>
              {pinned.length === 0 ? null : (
                <div className="mt-1 shrink-0 border-t border-edge-subtle pt-1">
                  {pinned.map((item) => (
                    <MenuRow
                      key={item.id}
                      item={item}
                      choosing={choosing}
                      onRun={run}
                    />
                  ))}
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

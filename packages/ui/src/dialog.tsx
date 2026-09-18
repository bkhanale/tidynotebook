/**
 * The one modal dialog of the application.
 *
 * The dialog owns every rule that a modal needs, so no screen repeats them:
 * a labelled title, Escape, a focus trap on Tab and Shift plus Tab, focus
 * restore to the element that opened it, and `inert` on the page behind it
 * where the browser supports that property. The scrim uses the theme token,
 * so both palettes dim the page by the same amount.
 *
 * The panel is the largest radius of the named scale, the card fill, the
 * subtle edge and the modal elevation step. Its three parts separate by space
 * and not by a rule: three rules across one small panel is the look of a
 * generated form, and the title, the body and the footer already differ in
 * type and in alignment. See
 * [decision 0063](../../../docs/decisions/0063-the-resting-edge-of-a-control-is-the-divider.md)
 * and
 * [decision 0065](../../../docs/decisions/0065-one-recipe-for-a-control-and-one-grid-for-an-icon.md).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { transitionRaise } from './motion.ts';

/** How wide a dialog panel is. */
export type DialogWidth = 'small' | 'medium' | 'large';

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Marks the page behind the dialog inert where the browser supports it. */
function setPageInert(panel: HTMLElement | null, inert: boolean): () => void {
  const body = document.body;
  const container = panel?.closest('[data-notes-dialog-root]') ?? null;
  const changed: HTMLElement[] = [];
  for (const child of Array.from(body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (container !== null && child.contains(container)) continue;
    if (!('inert' in child)) continue;
    if (child.inert === inert) continue;
    child.inert = inert;
    changed.push(child);
  }
  return () => {
    for (const element of changed) element.inert = !inert;
  };
}

/**
 * A modal dialog.
 *
 * `open` controls visibility. `onClose` runs for Escape, for the close
 * control, and for a pointer press on the scrim. The panel receives focus
 * when it opens unless a child already claimed it.
 */
export function Dialog({
  open,
  onClose,
  title,
  titleId,
  hideTitle = false,
  width = 'medium',
  align = 'top',
  children,
  describedBy,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly titleId: string;
  /** Keeps the title for assistive technology only. */
  readonly hideTitle?: boolean | undefined;
  readonly width?: DialogWidth | undefined;
  readonly align?: 'top' | 'center' | undefined;
  readonly children: ReactNode;
  readonly describedBy?: string | undefined;
}): ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // The latest close handler, which the effect below reads when a key or a
  // pointer asks for it. A screen passes a new function on every render, and
  // the effect must not run again for that: it moves focus when it starts and
  // when it ends, so a repeat would take the caret out of the field a person
  // is typing in.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    const panel = panelRef.current;
    const releaseInert = setPageInert(panel, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = (): HTMLElement[] =>
      panel === null
        ? []
        : Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
    window.requestAnimationFrame(() => {
      const targets = focusables();
      if (panel !== null && !panel.contains(document.activeElement))
        (targets[0] ?? panel).focus();
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const targets = focusables();
      const first = targets[0];
      const last = targets.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture phase: the open dialog owns Escape before any other window
    // handler, such as the drawer behind it, can act on the same press.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      releaseInert();
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const measure =
    width === 'small'
      ? 'max-w-md'
      : width === 'large'
        ? 'max-w-3xl'
        : 'max-w-xl';
  const position =
    align === 'center' ? 'items-center py-6' : 'items-start pb-6 pt-20';

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center overflow-y-auto bg-scrim/40 px-gutter ${position} ${transitionRaise}`}
      data-notes-dialog-root=""
      role="presentation"
      onMouseDown={(event): void => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`w-full ${measure} overflow-hidden rounded-xl border border-edge-subtle bg-card text-ink shadow-modal outline-none ${transitionRaise}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        <h2
          className={
            hideTitle
              ? 'sr-only'
              : 'm-0 px-5 pb-1 pt-4 text-ui font-semibold text-strong'
          }
          id={titleId}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** The standard padded body of a dialog. */
export function DialogBody({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return <div className="px-5 py-3">{children}</div>;
}

/**
 * The action row at the bottom of a dialog.
 *
 * The buttons sit at the end of the row, because the confirming action is the
 * last thing a person reads and the closest to where their pointer already
 * is. There is no rule above them: the space is the separation.
 */
export function DialogFooter({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-wrap justify-end gap-cluster px-5 pb-4 pt-2">
      {children}
    </div>
  );
}

/**
 * Accessible application controls.
 *
 * Every control is a thin wrapper over a native element, so keyboard use,
 * focus, labels, and touch target size come from the platform. Styling uses
 * the central Tailwind theme and a fixed control scale.
 */
import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import {
  badgeClassName,
  buttonClassName,
  type BadgeTone,
  type ButtonSize,
  type ButtonVariant,
} from './control-classes.ts';
import { ChevronDownIcon, ChevronRightIcon } from './icons.tsx';
import { transitionField, transitionSurface } from './motion.ts';

/** A labeled push button. */
export function Button({
  type,
  variant = 'primary',
  size = 'md',
  disabled,
  onClick,
  children,
  label,
  icon,
  className: extraClassName,
  title,
  buttonRef,
  ariaControls,
  ariaExpanded,
}: {
  readonly type?: 'button' | 'submit' | undefined;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly disabled?: boolean | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly children?: ReactNode | undefined;
  readonly label?: string | undefined;
  readonly icon?: ReactNode | undefined;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
  readonly ariaControls?: string | undefined;
  readonly ariaExpanded?: boolean | undefined;
}): ReactNode {
  const classes = buttonClassName({
    variant,
    size,
    className: extraClassName,
  });

  // WCAG 2.5.3 Label in Name: a visible label is the accessible name. Only
  // an icon-only button names itself with `aria-label`.
  const hasChildren = children !== undefined && children !== null;

  return (
    <button
      ref={buttonRef}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled ?? false}
      onClick={onClick}
      aria-label={hasChildren ? undefined : label}
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      title={title ?? (hasChildren ? undefined : label)}
    >
      {icon !== undefined ? (
        <span
          className="inline-flex items-center justify-center"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      {children === undefined || children === null ? null : (
        <span>{children}</span>
      )}
    </button>
  );
}

/** A small status badge pill. */
export function Badge({
  children,
  variant = 'default',
}: {
  readonly children: ReactNode;
  readonly variant?: BadgeTone | undefined;
}): ReactNode {
  return <span className={badgeClassName(variant)}>{children}</span>;
}

/**
 * A labeled text input with an optional rule and an optional field error.
 *
 * `hint` states the rule of the field before anything is submitted, so a
 * person never learns a requirement from a failure. Both the hint and the
 * error are named by `aria-describedby`, so a screen reader reads them with
 * the field.
 *
 * The field carries no length rule of its own. A browser that enforces one
 * answers with its own bubble in its own words, which would compete with
 * the hint and the error of the screen. The screen checks the length and
 * reports it here.
 */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  inputType,
  autoComplete,
  placeholder,
  required,
  autoFocus,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  /** The rule of the field, stated under it at all times. */
  readonly hint?: string | undefined;
  readonly inputType?: 'text' | 'email' | 'password' | undefined;
  readonly autoComplete?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly required?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
}): ReactNode {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const hasError = error !== undefined && error !== '';
  const hasHint = hint !== undefined && hint !== '';
  const described = [hasHint ? hintId : '', hasError ? errorId : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="mb-3.5">
      <label
        className="mb-1.5 block text-control font-semibold text-strong"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        id={id}
        className={`w-full rounded-lg border bg-app px-3 py-2 text-ui text-strong outline-none ${transitionField} focus:ring-2 focus:ring-focus/25 ${hasError ? 'border-danger focus:border-danger' : 'border-edge focus:border-focus'}`}
        type={inputType ?? 'text'}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required ?? false}
        autoFocus={autoFocus ?? false}
        aria-invalid={hasError}
        aria-describedby={described === '' ? undefined : described}
        onChange={(event): void => {
          onChange(event.target.value);
        }}
      />
      {hasHint ? (
        <p className="mb-0 mt-1 text-control text-muted" id={hintId}>
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p className="mt-1 text-control text-danger" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A labelled value that a person copies and cannot change.
 *
 * A machine value such as a link is text that a person moves to another
 * program, so the field carries it in a monospaced face, selects the whole
 * value whenever it takes focus, and stays a real input that the keyboard
 * reaches. A read only input keeps the value selectable and copyable, which a
 * paragraph of text does not.
 *
 * The field takes no `onChange`, so nothing can write through it, and it
 * reports `readonly` to assistive technology rather than `disabled`, because
 * a disabled control leaves the tab order and the value with it.
 *
 * `takeFocus` moves the caret here when the field appears. It calls `focus`
 * from an effect rather than passing the `autoFocus` attribute, because that
 * attribute acts while a document loads and this field appears long after
 * that, inside an open dialog, in answer to an action.
 */
export function ReadOnlyField({
  id,
  label,
  value,
  takeFocus,
  describedBy,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Takes focus when the field appears, for a value shown one time. */
  readonly takeFocus?: boolean | undefined;
  readonly describedBy?: string | undefined;
}): ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (takeFocus !== true) return;
    inputRef.current?.focus();
  }, [takeFocus]);
  return (
    <div className="mb-3.5">
      <label
        className="mb-1.5 block text-control font-semibold text-strong"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className={`w-full rounded-lg border border-edge bg-app px-3 py-2 font-mono text-control text-strong outline-none ${transitionField} focus:border-focus focus:ring-2 focus:ring-focus/25`}
        type="text"
        value={value}
        readOnly
        aria-describedby={describedBy}
        onFocus={(event): void => {
          event.currentTarget.select();
        }}
      />
    </div>
  );
}

/** One option of {@link SelectField}. */
export type SelectOption = {
  readonly value: string;
  readonly label: string;
};

/** A labeled native select. */
export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <div className="mb-3.5">
      <label
        className="mb-1.5 block text-control font-semibold text-strong"
        htmlFor={id}
      >
        {label}
      </label>
      <select
        id={id}
        className={`min-h-11 w-full rounded-lg border border-edge bg-app px-3 py-2 text-ui text-strong outline-none ${transitionField} focus:border-focus focus:ring-2 focus:ring-focus/25 md:min-h-9`}
        value={value}
        onChange={(event): void => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A collapsible region, for the outline panel.
 *
 * The toggle button owns `aria-expanded` and the panel is a labeled region,
 * so screen reader and keyboard users can open, enter, and close it.
 */
export function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly children: ReactNode;
}): ReactNode {
  const panelId = `${id}-panel`;
  return (
    <section className="mt-2" aria-labelledby={id}>
      <button
        id={id}
        type="button"
        className={`flex min-h-11 w-full cursor-pointer items-center gap-cluster rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-control font-semibold uppercase tracking-wide text-muted ${transitionSurface} hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-focus md:min-h-8`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(): void => {
          onToggle(!open);
        }}
      >
        <span className="inline-flex items-center" aria-hidden="true">
          {open ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
        </span>
        <span className="flex-1">{title}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="py-2 pl-2"
          role="region"
          aria-label={title}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A polite live status region.
 *
 * Sync and save states render here with `role="status"`, so assistive
 * technology announces changes without moving focus.
 */
export function StatusRegion({
  message,
}: {
  readonly message: string;
}): ReactNode {
  return (
    <p
      className="my-1 text-control text-muted"
      role="status"
      aria-live="polite"
    >
      {message}
    </p>
  );
}

/**
 * Accessible application controls.
 *
 * Every control is a thin wrapper over a native element, so keyboard use,
 * focus, labels, and touch target size come from the platform. Styling uses
 * the central Tailwind theme and a fixed control scale.
 */
import type { ReactNode, Ref } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from './icons.tsx';

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
  readonly variant?:
    'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle' | undefined;
  readonly size?: 'sm' | 'md' | undefined;
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
  const variantClass =
    variant === 'secondary'
      ? 'border-edge bg-transparent text-strong hover:bg-hover'
      : variant === 'danger'
        ? 'border-danger bg-danger text-white hover:brightness-110'
        : variant === 'ghost'
          ? 'border-transparent bg-transparent text-strong hover:bg-hover'
          : variant === 'subtle'
            ? 'border-edge-subtle bg-hover text-strong hover:bg-active'
            : 'border-accent-fill bg-accent-fill text-on-accent shadow-sm hover:brightness-110';

  const sizeClass = size === 'sm' ? 'h-8 px-2.5' : 'min-h-9 px-3';
  const classes = [
    'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border py-1.5 text-control font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
    variantClass,
    sizeClass,
    extraClassName ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={buttonRef}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled ?? false}
      onClick={onClick}
      aria-label={label}
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      title={title}
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
  readonly variant?:
    'default' | 'accent' | 'success' | 'danger' | 'warning' | undefined;
}): ReactNode {
  const variantClass =
    variant === 'accent'
      ? 'border-accent/30 bg-accent/15 text-accent'
      : variant === 'success'
        ? 'border-success/30 bg-success/15 text-success'
        : variant === 'danger'
          ? 'border-danger/30 bg-danger/15 text-danger'
          : variant === 'warning'
            ? 'border-accent/30 bg-accent/15 text-accent'
            : 'border-edge-subtle bg-hover text-muted';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${variantClass}`}
    >
      {children}
    </span>
  );
}

/** A labeled text input with an optional field error. */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  inputType,
  autoComplete,
  placeholder,
  required,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly inputType?: 'text' | 'email' | 'password' | undefined;
  readonly autoComplete?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly required?: boolean | undefined;
}): ReactNode {
  const errorId = `${id}-error`;
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
        className="w-full rounded-lg border border-edge bg-app px-3 py-2 text-ui text-strong outline-none transition-shadow focus:border-focus focus:ring-2 focus:ring-focus/25"
        type={inputType ?? 'text'}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required ?? false}
        aria-invalid={error !== undefined && error !== ''}
        aria-describedby={
          error !== undefined && error !== '' ? errorId : undefined
        }
        onChange={(event): void => {
          onChange(event.target.value);
        }}
      />
      {error !== undefined && error !== '' ? (
        <p className="mt-1 text-control text-danger" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
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
        className="w-full rounded-lg border border-edge bg-app px-3 py-2 text-ui text-strong outline-none transition-shadow focus:border-focus focus:ring-2 focus:ring-focus/25"
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
 * A collapsible region, for the outline and backlinks panel.
 *
 * The toggle button owns `aria-expanded` and the panel is a labeled region,
 * so screen reader and keyboard users can open, enter, and close it.
 */
export function CollapsibleSection({
  id,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: number | undefined;
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
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-control font-semibold uppercase tracking-wide text-muted hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-focus"
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
        {count !== undefined && count > 0 ? (
          <span className="rounded-full bg-hover px-1.5 py-0.5 text-xs font-medium text-muted">
            {count}
          </span>
        ) : null}
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

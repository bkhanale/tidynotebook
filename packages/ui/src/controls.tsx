/**
 * Accessible application controls.
 *
 * Every control is a thin wrapper over a native element, so keyboard use,
 * focus, labels, and touch target size come from the platform. Styling uses
 * the classes in `tokens.css`, which guarantees visible focus rings,
 * reduced motion support, and clear interactive feedback.
 */
import type { CSSProperties, ReactNode } from 'react';
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
  style,
  title,
}: {
  readonly type?: 'button' | 'submit' | undefined;
  readonly variant?:
    'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle' | undefined;
  readonly size?: 'sm' | 'md' | undefined;
  readonly disabled?: boolean | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly children: ReactNode;
  readonly label?: string | undefined;
  readonly icon?: ReactNode | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly title?: string | undefined;
}): ReactNode {
  const variantClass =
    variant === 'secondary'
      ? 'notes-button-secondary'
      : variant === 'danger'
        ? 'notes-button-danger'
        : variant === 'ghost'
          ? 'notes-button-ghost'
          : variant === 'subtle'
            ? 'notes-button-subtle'
            : 'notes-button-primary';

  const sizeClass = size === 'sm' ? 'notes-button-sm' : '';
  const classes = [
    'notes-button',
    variantClass,
    sizeClass,
    extraClassName ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled ?? false}
      onClick={onClick}
      aria-label={label}
      style={style}
      title={title}
    >
      {icon !== undefined ? (
        <span className="notes-button-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="notes-button-label">{children}</span>
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
  return (
    <span className={`notes-badge notes-badge-${variant}`}>{children}</span>
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
    <div className="notes-field-group">
      <label className="notes-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="notes-input"
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
        <p className="notes-field-error" id={errorId} role="alert">
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
    <div className="notes-field-group">
      <label className="notes-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="notes-select"
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
    <section className="notes-collapsible" aria-labelledby={id}>
      <button
        id={id}
        type="button"
        className="notes-collapsible-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(): void => {
          onToggle(!open);
        }}
      >
        <span className="notes-collapsible-icon" aria-hidden="true">
          {open ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
        </span>
        <span className="notes-collapsible-title">{title}</span>
        {count !== undefined && count > 0 ? (
          <span className="notes-collapsible-count">{count}</span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          className="notes-collapsible-content"
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
    <p className="notes-status-region" role="status" aria-live="polite">
      {message}
    </p>
  );
}

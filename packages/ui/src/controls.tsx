/**
 * Accessible application controls.
 *
 * Every control is a thin wrapper over a native element, so keyboard use,
 * focus, labels, and touch target size come from the platform. Styling uses
 * the classes in `tokens.css`, which guarantees a 44 pixel minimum target,
 * a visible focus ring, and reduced motion support. Controls take plain
 * props and know nothing about accounts, workspaces, or the network.
 */
import type { ReactNode } from 'react';

/** A labeled push button. */
export function Button({
  type,
  variant,
  disabled,
  onClick,
  children,
  label,
}: {
  readonly type?: 'button' | 'submit' | undefined;
  readonly variant?: 'primary' | 'secondary' | 'danger' | undefined;
  readonly disabled?: boolean | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly children: ReactNode;
  readonly label?: string | undefined;
}): ReactNode {
  const className =
    variant === 'secondary'
      ? 'notes-button notes-button-secondary'
      : variant === 'danger'
        ? 'notes-button notes-button-danger'
        : 'notes-button';
  return (
    <button
      type={type ?? 'button'}
      className={className}
      disabled={disabled ?? false}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
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
    <div>
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
    <div>
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
    <section aria-labelledby={id}>
      <button
        id={id}
        type="button"
        className="notes-button notes-button-secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(): void => {
          onToggle(!open);
        }}
      >
        {title}
      </button>
      {open ? (
        <div id={panelId} role="region" aria-label={title}>
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
    <p role="status" aria-live="polite">
      {message}
    </p>
  );
}

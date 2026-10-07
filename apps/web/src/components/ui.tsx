import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { forwardRef, useId } from 'react';
import { Icon, type IconName } from './Icon.tsx';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'default' | 'primary' | 'danger' | 'danger-solid' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  default: 'border-line bg-surface text-ink hover:bg-surface-sunk',
  primary: 'border-accent bg-accent text-accent-ink font-semibold hover:brightness-110',
  danger: 'border-line bg-surface text-danger hover:bg-danger-soft',
  'danger-solid': 'border-danger bg-danger text-surface font-semibold hover:brightness-110',
  ghost: 'border-transparent bg-transparent text-ink-muted hover:bg-surface-sunk hover:text-ink',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', icon, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-control border font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-[0.82rem]' : 'px-3 py-1.5 text-[0.9rem]',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
});

export function IconButton({
  icon,
  label,
  className,
  ...rest
}: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'grid size-9 place-items-center rounded-[9px] text-ink-muted transition hover:bg-surface-sunk hover:text-ink',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Caps({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('text-[0.7rem] font-semibold tracking-[0.11em] text-ink-muted uppercase', className)}>
      {children}
    </span>
  );
}

/** Inputs fill their container unless a width class is passed. */
const hasWidth = (c?: string) => !!c && /(^|\s)w-/.test(c);

const inputBase =
  'min-w-0 rounded-[9px] border border-line bg-wall px-3 py-2 text-[0.93rem] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20 aria-invalid:border-danger';

export function Field({
  label,
  help,
  error,
  children,
  htmlFor,
  className,
  aside,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  /** Shown at the end of the label row, outside the label (e.g. where the value came from). */
  aside?: ReactNode;
}) {
  const labelEl = (
    <label htmlFor={htmlFor} className="text-[0.72rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
      {label}
    </label>
  );
  return (
    <div className={cx('grid content-start gap-1.5', className)}>
      {aside ? (
        <div className="flex items-baseline justify-between gap-2">
          {labelEl}
          {aside}
        </div>
      ) : (
        labelEl
      )}
      {children}
      {error ? (
        <span className="text-[0.8rem] text-danger" role="alert">
          {error}
        </span>
      ) : (
        help && <span className="text-[0.78rem] text-ink-faint">{help}</span>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(inputBase, !hasWidth(className) && 'w-full', className)} {...rest} />;
});

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputBase, 'min-h-24 w-full resize-y', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(inputBase, !hasWidth(className) && 'w-full', 'cursor-pointer appearance-auto pr-8', className)}
      {...rest}
    >
      {children}
    </select>
  );
}

/** A labelled text field in one go. */
export function TextField({
  label,
  help,
  error,
  aside,
  ...rest
}: { label: ReactNode; help?: ReactNode; error?: string; aside?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} htmlFor={rest.id ?? id} aside={aside}>
      <TextInput id={rest.id ?? id} aria-invalid={!!error || undefined} {...rest} />
    </Field>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap overflow-hidden rounded-[9px] border border-line bg-surface"
    >
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: styled buttons with radio semantics
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'px-3 py-1.5 text-[0.85rem] text-ink-muted transition disabled:cursor-not-allowed disabled:opacity-45',
            o.value === value && 'bg-ink font-semibold text-surface',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  pressed,
  children,
  onClick,
  onRemove,
}: {
  pressed?: boolean;
  children: ReactNode;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border text-[0.84rem]',
        pressed ? 'border-ink bg-ink text-surface' : 'border-line bg-surface',
      )}
    >
      <button type="button" aria-pressed={pressed} onClick={onClick} className="py-1 pl-3 pr-1 last:pr-3">
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          className="grid size-6 place-items-center rounded-full pr-1"
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-10 text-ink-muted" aria-live="polite">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}…
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-control border border-danger/40 bg-danger-soft px-3 py-2 text-[0.9rem] text-ink"
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded-sheet border-[1.5px] border-dashed border-line px-4 py-12 text-center text-ink-muted">
      <b className="text-[1.05rem] text-ink">{title}</b>
      {children && <p className="max-w-[46ch]">{children}</p>}
      {action}
    </div>
  );
}

/** An inline "are you sure" strip, used instead of browser dialogs. */
export function ConfirmStrip({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={confirmLabel}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-danger-soft px-4 py-3 text-[0.92rem] sm:px-8"
    >
      <span>{message}</span>
      <span className="ml-auto flex gap-2">
        <Button onClick={onCancel} autoFocus>
          Cancel
        </Button>
        <Button variant="danger-solid" onClick={onConfirm} disabled={busy}>
          {busy ? 'Deleting…' : confirmLabel}
        </Button>
      </span>
    </div>
  );
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  // A stable hue per name so each person keeps their colour.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      title={name}
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `oklch(0.52 0.13 ${h})` }}
    >
      {initials || '?'}
    </span>
  );
}

export { cx };

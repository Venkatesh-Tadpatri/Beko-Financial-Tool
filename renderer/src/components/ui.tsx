import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <rect width="34" height="34" rx="9" fill={light ? '#ffffff14' : '#2453d4'} />
        <rect x="8" y="17" width="4" height="9" rx="1.5" fill="#2dd4bf" />
        <rect x="15" y="12" width="4" height="14" rx="1.5" fill={light ? '#ffffff' : '#dbe5ff'} />
        <rect x="22" y="7" width="4" height="19" rx="1.5" fill={light ? '#9fb0c8' : '#ffffff'} />
      </svg>
      <div className="leading-tight">
        <div className={`font-heading text-[15px] font-semibold ${light ? 'text-white' : 'text-ink'}`}>
          Financial Visualization
        </div>
        <div className={`text-xs ${light ? 'text-navy-300' : 'text-muted'}`}>Tool</div>
      </div>
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'bg-white text-ink border border-line hover:bg-canvas disabled:opacity-50',
  ghost: 'text-muted hover:text-ink hover:bg-canvas',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  type = 'text',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`h-11 w-full rounded-lg border bg-white px-3 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 ${
            error ? 'border-red-400' : 'border-line'
          } ${isPassword ? 'pr-16' : ''}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-medium text-muted hover:text-ink"
            aria-label={reveal ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${id}-err`} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

const ALERT_STYLES = {
  info: 'border-brand-100 bg-brand-50 text-brand-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-800',
};

export function Alert({ kind, children }: { kind: keyof typeof ALERT_STYLES; children: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3.5 py-2.5 text-sm ${ALERT_STYLES[kind]}`}>
      {children}
    </div>
  );
}

export function Spinner({ small = false }: { small?: boolean }) {
  const size = small ? 'h-4 w-4 border-2' : 'h-8 w-8 border-[3px]';
  return <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-current border-r-transparent ${size}`} />;
}

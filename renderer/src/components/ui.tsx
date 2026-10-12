import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import bekoLogo from '../assets/beko-logo.png';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white p-0.5 shadow-sm">
        <img src={bekoLogo} alt="BEKO" className="h-full w-full object-contain" />
      </span>
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
  icon,
  large = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; icon?: 'user' | 'lock'; large?: boolean }) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <svg aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 my-auto h-5 w-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {icon === 'user' ? (
              <path d="M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
            ) : (
              <path d="M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5V11Z" />
            )}
          </svg>
        )}
        <input
          id={id}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`${large ? 'h-[52px] rounded-xl' : 'h-11 rounded-lg'} w-full border bg-white px-3 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 ${
            error ? 'border-red-400' : 'border-line'
          } ${isPassword ? 'pr-12' : ''} ${icon ? 'pl-11' : ''}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute inset-y-0 right-2 my-auto grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-canvas hover:text-ink"
            aria-label={reveal ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            title={reveal ? 'Hide' : 'Show'}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {reveal && <path d="M4 4l16 16" />}
            </svg>
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
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${ALERT_STYLES[kind]}`}>
      <svg aria-hidden="true" className="mt-px h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="currentColor">
        {kind === 'success' ? (
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7Z" />
        ) : kind === 'info' ? (
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z" />
        ) : (
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z" />
        )}
      </svg>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ small = false }: { small?: boolean }) {
  const size = small ? 'h-4 w-4 border-2' : 'h-8 w-8 border-[3px]';
  return <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-current border-r-transparent ${size}`} />;
}

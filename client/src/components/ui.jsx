// Small shared building blocks. All interactive elements are real buttons, links,
// inputs and dialogs, so they work with a keyboard and a screen reader by default.
import { useEffect, useId, useRef, useState } from 'react';
import { duration } from '../lib/format.js';
import { serverNow, useClock } from '../lib/realtime.js';

const BUTTON = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/50',
  secondary: 'bg-white text-stone-800 ring-1 ring-inset ring-stone-300 hover:bg-stone-100 disabled:text-stone-400',
  danger: 'bg-white text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 disabled:text-red-300',
  ghost: 'text-brand-800 hover:bg-brand-50 disabled:text-stone-400',
};

export function Button({ variant = 'primary', busy = false, disabled, className = '', children, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${BUTTON[variant]} ${className}`}
      {...rest}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small = false, label }) {
  return (
    <span className="inline-flex items-center gap-2" role={label ? 'status' : undefined}>
      <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? 'h-4 w-4' : 'h-6 w-6'}`} aria-hidden="true" />
      {label && <span className="text-sm text-stone-600">{label}</span>}
    </span>
  );
}

/** Label + control + hint + error, correctly wired together for assistive technology. */
export function Field({ label, error, hint, required, children, className = '' }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="text-red-700" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy, required })}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-stone-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const BADGE = {
  green: 'bg-brand-100 text-brand-900 ring-brand-600/30',
  amber: 'bg-amber-100 text-amber-900 ring-amber-600/40',
  red: 'bg-red-100 text-red-900 ring-red-600/30',
  blue: 'bg-sky-100 text-sky-900 ring-sky-600/30',
  gray: 'bg-stone-100 text-stone-700 ring-stone-500/30',
};
export function Badge({ tone = 'gray', children, className = '' }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${BADGE[tone]} ${className}`}>{children}</span>;
}

const ALERT = {
  error: 'border-red-300 bg-red-50 text-red-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  info: 'border-sky-300 bg-sky-50 text-sky-900',
  success: 'border-brand-200 bg-brand-50 text-brand-900',
};
export function Alert({ tone = 'info', title, children, action, className = '' }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm ${ALERT[tone]} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="break-words">{children}</div>
      </div>
      {action}
    </div>
  );
}

/** Accessible modal built on the native <dialog>: focus is trapped and Esc closes it. */
export function Modal({ open, onClose, title, children, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // Start keyboard users on the main control (marked data-autofocus), not on the close button.
      const first = el.querySelector('[data-autofocus]');
      if (first) {
        first.focus();
        first.select?.();
      }
    }
    if (!open && el.open) el.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`w-[calc(100%-2rem)] rounded-xl bg-white p-0 shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
    >
      <div className="max-h-[85vh] overflow-y-auto p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-bold text-stone-900">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="-m-2 rounded p-2 text-2xl leading-none text-stone-500 hover:text-stone-900" aria-label="Close dialog">
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Confirmation step for destructive actions. */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onClose, busy }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-stone-700">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus>
          Keep it
        </Button>
        <Button variant="danger" onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-base font-semibold text-stone-800">{title}</p>
      {children && <p className="max-w-md text-sm text-stone-600">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Shown when a page could not load its data; always offers a way to recover. */
export function LoadError({ error, onRetry }) {
  return (
    <Alert
      tone="error"
      title="This could not be loaded"
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {error?.message || 'Please try again.'}
    </Alert>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex justify-center py-12">
      <Spinner label={label} />
    </div>
  );
}

export function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-5 flex items-center justify-center gap-3" aria-label="Pagination">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-stone-700" aria-current="page">
        Page {page} of {totalPages}
      </span>
      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

/** Re-renders on a timer and returns the current server time in ms. */
export function useNow(intervalMs = 1000) {
  useClock(); // re-render when the server clock is corrected or fast-forwarded
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return serverNow();
}

/** Time left until a deadline, coloured by urgency. Uses the server clock. */
export function Countdown({ until, prefix = '', expiredLabel = 'Expired', className = '' }) {
  const now = useNow(1000);
  const left = new Date(until).getTime() - now;
  if (left <= 0) return <span className={`font-semibold text-red-700 ${className}`}>{expiredLabel}</span>;
  const tone = left < 30 * 60_000 ? 'text-red-700' : left < 90 * 60_000 ? 'text-amber-700' : 'text-stone-800';
  return (
    <span className={`tabular font-semibold ${tone} ${className}`}>
      {prefix}
      {duration(left)}
    </span>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-stone-200" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${value === t.value ? 'border-brand-700 text-brand-800' : 'border-transparent text-stone-600 hover:text-stone-900'}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-stone-200 px-1.5 py-0.5 text-xs text-stone-700">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Loads data for a page and exposes { data, error, loading, reload }.
 * `reload({ silent: true })` refreshes in the background without a spinner,
 * and a response that arrives out of order is ignored.
 */
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const reload = useRef(async ({ silent = false } = {}) => {
    const mine = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loaderRef.current();
      if (mine === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      // A background refresh that fails keeps the data already on screen.
      if (mine === seq.current) setState((s) => (silent && s.data ? { ...s, loading: false } : { data: null, error, loading: false }));
    }
  }).current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps);
  return { ...state, reload, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

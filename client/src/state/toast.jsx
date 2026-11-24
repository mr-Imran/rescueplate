import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

const TONES = {
  success: 'border-brand-600 bg-brand-50 text-brand-900',
  error: 'border-red-600 bg-red-50 text-red-900',
  info: 'border-stone-400 bg-white text-stone-900',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone, message, { title, ms } = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, tone, message, title }]);
      setTimeout(() => dismiss(id), ms ?? (tone === 'error' ? 9000 : 5000));
    },
    [dismiss],
  );
  const value = useMemo(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      info: (m, o) => push('info', m, o),
      /** Shows the message from a failed API call. */
      fromError: (err, title) => push('error', err?.message || 'Something went wrong. Please try again.', { title }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Polite live region: screen readers announce results without stealing focus. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border-l-4 p-3 shadow-lg ring-1 ring-black/5 ${TONES[t.tone]}`}>
            <div className="min-w-0 flex-1 text-sm">
              {t.title && <p className="font-semibold">{t.title}</p>}
              <p className="break-words">{t.message}</p>
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="-m-1 rounded p-1 text-lg leading-none opacity-70 hover:opacity-100" aria-label="Dismiss notification">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

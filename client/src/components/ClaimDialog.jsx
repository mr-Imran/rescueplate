import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, newIdempotencyKey } from '../lib/api.js';
import { meals as mealsText } from '../lib/format.js';
import { isClaimable } from './ListingCard.jsx';
import { Alert, Button, Countdown, Field, Modal, useNow } from './ui.jsx';

/**
 * Claim form. `listing` is the live copy from the page, so the "meals left"
 * figure keeps updating while the dialog is open.
 */
export function ClaimDialog({ listing, onClose, onClaimed }) {
  const now = useNow(1000);
  const [meals, setMeals] = useState('');
  const [allowPartial, setAllowPartial] = useState(true);
  const [capacity, setCapacity] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [result, setResult] = useState(null);
  // One key per user intent. A retry after a network failure re-sends the SAME
  // key, so the server can never record the claim twice.
  const key = useRef(newIdempotencyKey());
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/org')
      .then((d) => !cancelled && setCapacity(d.capacity))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Suggest the largest sensible amount until the user types their own number.
  const suggested = Math.max(1, Math.min(listing.remainingMeals, capacity ? Math.max(capacity.left, 1) : listing.remainingMeals));
  const inputRef = useRef(null);
  useEffect(() => {
    if (touched.current) return;
    setMeals(String(suggested));
    // Keep the suggestion selected so typing a number replaces it.
    requestAnimationFrame(() => document.activeElement === inputRef.current && inputRef.current.select());
  }, [suggested]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return; // double-click guard (the idempotency key covers everything else)
    const n = Number(meals);
    if (!Number.isInteger(n) || n < 1) return setFieldError('Enter a whole number of meals, 1 or more.');
    if (n > 5000) return setFieldError('That is more than a single claim allows (5000).');
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      const res = await api.claim(listing.id, { meals: n, allowPartial }, key.current);
      setResult(res);
      onClaimed?.(res);
    } catch (err) {
      setError(err);
      if (err.fieldErrors?.meals) setFieldError(err.fieldErrors.meals);
      // The server gave a definite answer: the next attempt is a new intent.
      // After a network failure we keep the key so "Try again" stays safe.
      if (!err.transient) key.current = newIdempotencyKey();
    } finally {
      setBusy(false);
    }
  };

  const claimable = isClaimable(listing, now);
  return (
    <Modal open onClose={onClose} title={result ? 'Claim confirmed' : `Claim from ${listing.donor.name}`}>
      {result ? (
        <div className="space-y-4">
          <Alert tone={result.decision.partial ? 'warning' : 'success'} title={`${mealsText(result.decision.granted)} reserved for you`}>
            {result.decision.explanation}
          </Alert>
          <p className="text-sm text-stone-700">
            Next step: assign a volunteer within <strong>30 minutes</strong>, or the meals go back to the feed for other NGOs.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Link to="/claims" className="inline-flex min-h-10 items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
              Assign a volunteer
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="rounded-lg bg-stone-100 p-3 text-sm">
            <p className="font-semibold text-stone-900">{listing.title}</p>
            <p className="mt-1 text-stone-700" aria-live="polite">
              <span className="tabular font-bold">{listing.remainingMeals}</span> meals left · safe for <Countdown until={listing.safeUntil} />
            </p>
            {capacity && (
              <p className="mt-1 text-stone-700">
                Your capacity left today: <span className="tabular font-bold">{capacity.left}</span> of {capacity.daily} meals
              </p>
            )}
          </div>
          {!claimable && <Alert tone="warning">This food can no longer be claimed. It was fully claimed, withdrawn or has passed its safe-until time.</Alert>}
          {error && (
            <Alert tone="error" title={error.transient ? 'Could not reach the server' : 'Claim not made'}>
              {error.message}
              {error.transient && ' It is safe to try again: the request will not be counted twice.'}
            </Alert>
          )}
          <Field label="How many meals?" required error={fieldError}>
            {(p) => (
              <input
                {...p}
                ref={inputRef}
                className="input"
                type="number"
                inputMode="numeric"
                min="1"
                max="5000"
                step="1"
                value={meals}
                onChange={(e) => {
                  touched.current = true;
                  setMeals(e.target.value);
                }}
                data-autofocus
              />
            )}
          </Field>
          <label className="flex items-start gap-2 text-sm text-stone-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} />
            <span>
              Accept fewer meals if someone else claims some first
              <span className="block text-xs text-stone-600">If unticked, you get the full amount or nothing.</span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" busy={busy} disabled={!claimable}>
              {error?.transient ? 'Try again' : 'Claim meals'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

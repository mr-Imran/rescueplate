import { useState } from 'react';
import { FOOD_LABELS, fromLocalInput, toLocalInput } from '../lib/format.js';
import { serverNow } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';
import { Button, Field } from './ui.jsx';

const HOUR = 3600_000;

export function emptyListingValues() {
  const now = serverNow();
  return { title: '', description: '', foodType: 'cooked_meal', isVeg: true, totalMeals: '', preparedAt: new Date(now - 15 * 60_000).toISOString(), safeUntil: new Date(now + 3 * HOUR).toISOString() };
}

/** Mirrors the server's rules for instant feedback. The server remains the authority. */
export function validateListing(v, foodTypes, { isNew, claimedMeals = 0 }) {
  const e = {};
  const title = v.title.trim();
  if (title.length < 3) e.title = 'Title must be at least 3 characters.';
  else if (title.length > 120) e.title = 'Title must be at most 120 characters.';
  if (v.description.length > 1000) e.description = 'Description must be at most 1000 characters.';

  const n = Number(v.totalMeals);
  if (v.totalMeals === '' || !Number.isInteger(n)) e.totalMeals = 'Enter a whole number of meals.';
  else if (n < 1) e.totalMeals = 'Number of meals must be at least 1.';
  else if (n > 5000) e.totalMeals = 'Number of meals must be at most 5000.';
  else if (n < claimedMeals) e.totalMeals = `${claimedMeals} meals are already claimed, so the total cannot go below ${claimedMeals}.`;

  const prepared = v.preparedAt ? new Date(v.preparedAt).getTime() : NaN;
  const safe = v.safeUntil ? new Date(v.safeUntil).getTime() : NaN;
  const now = serverNow();
  const type = foodTypes?.[v.foodType];
  if (Number.isNaN(prepared)) e.preparedAt = 'Enter when the food was prepared.';
  else if (prepared > now + 5 * 60_000) e.preparedAt = 'Prepared time cannot be in the future.';
  if (Number.isNaN(safe)) e.safeUntil = 'Enter until when the food is safe to eat.';
  else if (!Number.isNaN(prepared)) {
    if (safe <= prepared) e.safeUntil = 'Safe-until time must be after the prepared time.';
    else if (type && safe - prepared > type.maxSafeHours * HOUR) e.safeUntil = `${type.label} can be listed for at most ${type.maxSafeHours} hours after it was prepared.`;
    else if (safe <= now) e.safeUntil = 'Safe-until time has already passed.';
    else if (isNew && safe - now < 15 * 60_000) e.safeUntil = 'Food must stay safe for at least 15 more minutes so it can be collected.';
  }
  return e;
}

/**
 * Controlled listing form used for both posting and editing.
 * `frozen` lists fields that can no longer change (after food has been claimed).
 */
export function ListingForm({ values, onChange, errors = {}, onSubmit, busy, submitLabel, onCancel, frozen = [], children }) {
  const { config } = useAuth();
  const [touchedSafe, setTouchedSafe] = useState(false);
  const set = (key, value) => onChange({ ...values, [key]: value });
  const type = config?.foodTypes?.[values.foodType];
  const isFrozen = (f) => frozen.includes(f);
  const frozenHint = 'Locked because food has already been claimed.';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit(); // ignore a second submit while the first is in flight
      }}
      className="space-y-4"
      noValidate
    >
      <Field label="What is the food?" required error={errors.title} hint="For example: Shobji khichuri, 6 trays">
        {(p) => <input {...p} className="input" maxLength={120} value={values.title} onChange={(e) => set('title', e.target.value)} />}
      </Field>
      <Field label="Details for the collector" error={errors.description} hint={`Packaging, allergens, where to collect. ${values.description.length}/1000`}>
        {(p) => <textarea {...p} className="input min-h-20" maxLength={1000} value={values.description} onChange={(e) => set('description', e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Food type" required error={errors.foodType} hint={isFrozen('foodType') ? frozenHint : type ? `Listable for up to ${type.maxSafeHours} hours` : undefined}>
          {(p) => (
            <select {...p} className="input" disabled={isFrozen('foodType')} value={values.foodType} onChange={(e) => set('foodType', e.target.value)}>
              {Object.entries(FOOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Contains" required error={errors.isVeg} hint={isFrozen('isVeg') ? frozenHint : undefined}>
          {(p) => (
            <select {...p} className="input" disabled={isFrozen('isVeg')} value={values.isVeg ? 'veg' : 'nonveg'} onChange={(e) => set('isVeg', e.target.value === 'veg')}>
              <option value="veg">Vegetarian (no meat, fish or egg)</option>
              <option value="nonveg">Contains meat, fish or egg</option>
            </select>
          )}
        </Field>
        <Field label="Number of meals" required error={errors.totalMeals} hint="One meal feeds one person">
          {(p) => <input {...p} className="input" type="number" inputMode="numeric" min="1" max="5000" step="1" value={values.totalMeals} onChange={(e) => set('totalMeals', e.target.value)} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prepared at" required error={errors.preparedAt} hint={isFrozen('preparedAt') ? frozenHint : undefined}>
          {(p) => (
            <input
              {...p}
              className="input"
              type="datetime-local"
              disabled={isFrozen('preparedAt')}
              value={toLocalInput(values.preparedAt)}
              onChange={(e) => {
                const preparedAt = fromLocalInput(e.target.value) || '';
                // Until the donor sets the deadline by hand, keep it at a sensible default after "prepared".
                const next = { ...values, preparedAt };
                if (!touchedSafe && preparedAt && type) next.safeUntil = new Date(new Date(preparedAt).getTime() + Math.min(type.maxSafeHours, 4) * HOUR).toISOString();
                onChange(next);
              }}
            />
          )}
        </Field>
        <Field label="Safe to eat until" required error={errors.safeUntil} hint="After this time the listing closes automatically.">
          {(p) => (
            <input
              {...p}
              className="input"
              type="datetime-local"
              value={toLocalInput(values.safeUntil)}
              onChange={(e) => {
                setTouchedSafe(true);
                set('safeUntil', fromLocalInput(e.target.value) || '');
              }}
            />
          )}
        </Field>
      </div>
      {children}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" busy={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

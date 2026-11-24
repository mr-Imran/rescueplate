import { useState } from 'react';
import { FIELD_LABELS, formatValue } from '../lib/format.js';
import { Alert, Button, Modal } from './ui.jsx';

/**
 * Shown when two people changed the same field of the same record (a listing, or
 * the organization's details). Nothing has been saved yet: the user picks, per
 * field, which value to keep.
 */
export function ConflictDialog({ conflict, onResolve, onDiscard, busy, what = 'This listing' }) {
  const { conflicts, takenFromTheirs, keptMine, lastChange } = conflict;
  const [choice, setChoice] = useState(() => Object.fromEntries(conflicts.map((c) => [c.field, 'theirs'])));
  const who = lastChange?.actor || 'Someone else';

  return (
    <Modal open onClose={onDiscard} title={`${what} was changed while you were editing`} wide>
      <Alert tone="warning">
        <strong>{who}</strong> saved a newer version. Your changes have <strong>not</strong> been saved yet, and nothing was overwritten. Choose what to keep for each field below.
      </Alert>

      <div className="mt-4 space-y-3">
        {conflicts.map((c) => (
          <fieldset key={c.field} className="rounded-lg border border-stone-300 p-3">
            <legend className="px-1 text-sm font-bold">{FIELD_LABELS[c.field]}</legend>
            <p className="mb-2 text-xs text-stone-600">Before either change: {formatValue(c.field, c.base)}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { key: 'theirs', label: `Keep theirs (${who})`, value: c.theirs },
                { key: 'mine', label: 'Use mine', value: c.mine },
              ].map((o) => (
                <label key={o.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${choice[c.field] === o.key ? 'border-brand-600 bg-brand-50' : 'border-stone-200'}`}>
                  <input type="radio" name={`conflict-${c.field}`} className="mt-1 accent-brand-700" checked={choice[c.field] === o.key} onChange={() => setChoice({ ...choice, [c.field]: o.key })} />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-stone-600">{o.label}</span>
                    <span className="block break-words font-medium">{formatValue(c.field, o.value)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {(takenFromTheirs.length > 0 || keptMine.length > 0) && (
        <p className="mt-3 text-xs text-stone-600">
          Merged automatically:
          {keptMine.length > 0 && ` your change to ${keptMine.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}`}
          {keptMine.length > 0 && takenFromTheirs.length > 0 && ';'}
          {takenFromTheirs.length > 0 && ` their change to ${takenFromTheirs.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}`}.
        </p>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onDiscard} disabled={busy}>
          Discard my changes
        </Button>
        <Button onClick={() => onResolve(choice)} busy={busy}>
          Save merged version
        </Button>
      </div>
    </Modal>
  );
}

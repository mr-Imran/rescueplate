import { useState } from 'react';
import { Alert, Badge, Button, Field, LoadError, Loading, PageHeader, useLoad } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useLive } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

const STATUS = { VERIFIED: { tone: 'green', label: 'Verified' }, PENDING: { tone: 'amber', label: 'Waiting for verification' }, SUSPENDED: { tone: 'red', label: 'Suspended' } };

export default function Org() {
  const { refresh } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.get('/org'), []);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useLive('org.changed', () => reload({ silent: true }));
  useLive('claim.changed', () => reload({ silent: true })); // capacity used changes with every claim
  useLive('resync', () => reload({ silent: true }));

  if (error) return <LoadError error={error} onRetry={() => reload()} />;
  if (!data) return <Loading label="Loading organization…" />;
  const { org, members, capacity } = data;
  const isNgo = org.type === 'ngo';

  const startEdit = () => {
    setErrors({});
    setForm({ address: org.address, lat: String(org.lat), lng: String(org.lng), capacity: isNgo ? String(org.dailyCapacityMeals) : '' });
  };

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    const found = {};
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const cap = Number(form.capacity);
    if (form.address.trim().length < 5) found.address = 'Enter the full address.';
    if (form.lat === '' || Number.isNaN(lat) || lat < -90 || lat > 90) found.lat = 'Latitude must be between -90 and 90.';
    if (form.lng === '' || Number.isNaN(lng) || lng < -180 || lng > 180) found.lng = 'Longitude must be between -180 and 180.';
    if (isNgo && (!Number.isInteger(cap) || cap < 1 || cap > 100000)) found.dailyCapacityMeals = 'Enter a whole number of meals (1 or more).';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await api.patch('/org', { address: form.address.trim(), lat, lng, ...(isNgo ? { dailyCapacityMeals: cap } : {}) });
      toast.success('Organization details updated.');
      setForm(null);
      reload({ silent: true });
      refresh();
    } catch (err) {
      setErrors(err.fieldErrors);
      toast.fromError(err, 'Not saved');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(org.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.info(`Join code: ${org.joinCode}`);
    }
  };

  const used = capacity ? Math.min(100, Math.round((capacity.used / capacity.daily) * 100)) : 0;
  return (
    <>
      <PageHeader title={org.name} subtitle={isNgo ? 'NGO: receives food' : 'Donor: provides surplus food'}>
        <Badge tone={STATUS[org.status].tone}>{STATUS[org.status].label}</Badge>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5" aria-labelledby="org-details">
          <h2 id="org-details" className="mb-3 font-bold">
            Details
          </h2>
          {form ? (
            <form onSubmit={save} className="space-y-4" noValidate>
              <Field label="Address" required error={errors.address}>
                {(p) => <input {...p} className="input" maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitude" required error={errors.lat}>
                  {(p) => <input {...p} className="input" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />}
                </Field>
                <Field label="Longitude" required error={errors.lng}>
                  {(p) => <input {...p} className="input" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />}
                </Field>
              </div>
              {isNgo && (
                <Field label="Meals you can accept per day" required error={errors.dailyCapacityMeals} hint="Claims in any 24 hours cannot exceed this.">
                  {(p) => <input {...p} className="input" type="number" min="1" max="100000" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />}
                </Field>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setForm(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" busy={busy}>
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-stone-500">Address</dt>
                  <dd className="font-medium">{org.address}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Location (used for distances)</dt>
                  <dd className="tabular font-medium">
                    {org.lat}, {org.lng}
                  </dd>
                </div>
                {isNgo && (
                  <div>
                    <dt className="text-stone-500">Daily capacity</dt>
                    <dd className="font-medium">{org.dailyCapacityMeals} meals</dd>
                  </div>
                )}
              </dl>
              <Button variant="secondary" className="mt-4" onClick={startEdit}>
                Edit details
              </Button>
            </>
          )}
        </section>

        <div className="space-y-4">
          {capacity && (
            <section className="card p-5" aria-labelledby="org-capacity">
              <h2 id="org-capacity" className="font-bold">
                Capacity in the last 24 hours
              </h2>
              <p className="mt-2 text-sm text-stone-700">
                <span className="tabular text-2xl font-bold text-stone-900">{capacity.left}</span> of {capacity.daily} meals still available to claim
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200" role="img" aria-label={`${used}% of daily capacity used`}>
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${used}%` }} />
              </div>
              <p className="mt-1 text-xs text-stone-500">{capacity.used} meals claimed. Released and cancelled claims do not count.</p>
            </section>
          )}
          <section className="card p-5" aria-labelledby="org-team">
            <h2 id="org-team" className="font-bold">
              Team
            </h2>
            <ul className="mt-2 divide-y divide-stone-100 text-sm">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block font-medium">{m.name}</span>
                    <span className="block truncate text-stone-500">{m.email}</span>
                  </span>
                  {m.status !== 'ACTIVE' && <Badge tone="red">Suspended</Badge>}
                </li>
              ))}
            </ul>
            <Alert tone="info" className="mt-3" title="Invite a colleague">
              They choose “Join one with a code” when creating an account and enter{' '}
              <span className="tabular font-mono font-bold tracking-wider">{org.joinCode}</span>.{' '}
              <button type="button" className="link" onClick={copy}>
                {copied ? 'Copied' : 'Copy code'}
              </button>
            </Alert>
          </section>
        </div>
      </div>
    </>
  );
}

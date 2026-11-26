import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LocationPicker } from '../components/LocationPicker.jsx';
import { Alert, Button, Field } from '../components/ui.jsx';
import { useAuth } from '../state/auth.jsx';
import { AuthShell } from './Login.jsx';

const ROLES = [
  { value: 'donor', label: 'Food donor', hint: 'Restaurant, caterer, canteen or venue with surplus food' },
  { value: 'ngo', label: 'NGO', hint: 'Shelter, community kitchen or home that receives food' },
  { value: 'volunteer', label: 'Volunteer', hint: 'Collects food from donors and delivers it' },
];

/** Client-side checks give instant feedback. The server validates everything again. */
function validate(f) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Enter your name (at least 2 characters).';
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Enter a valid email address.';
  if (f.password.length < 8) e.password = 'Password must be at least 8 characters.';
  if (f.role !== 'volunteer') {
    if (f.orgMode === 'join') {
      if (f.joinCode.trim().length < 4) e.joinCode = 'Enter the join code from a colleague.';
    } else {
      if (f.orgName.trim().length < 2) e['org.name'] = 'Enter the organization name.';
      if (f.address.trim().length < 5) e['org.address'] = 'Enter the full address.';
      const lat = Number(f.lat);
      const lng = Number(f.lng);
      if (f.lat === '' || Number.isNaN(lat) || lat < -90 || lat > 90) e['org.lat'] = 'Latitude must be between -90 and 90.';
      if (f.lng === '' || Number.isNaN(lng) || lng < -180 || lng > 180) e['org.lng'] = 'Longitude must be between -180 and 180.';
      if (f.role === 'ngo') {
        const cap = Number(f.capacity);
        if (!Number.isInteger(cap) || cap < 1 || cap > 100000) e['org.dailyCapacityMeals'] = 'Enter a whole number of meals (1 or more).';
      }
    }
  }
  return e;
}

export default function Register() {
  const { register } = useAuth();
  const [f, setF] = useState({ role: 'donor', name: '', email: '', password: '', orgMode: 'new', joinCode: '', orgName: '', address: '', lat: '', lng: '', capacity: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const found = validate(f);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const payload = { name: f.name, email: f.email, password: f.password, role: f.role };
      if (f.role !== 'volunteer') {
        if (f.orgMode === 'join') payload.joinCode = f.joinCode.trim();
        else {
          payload.org = { name: f.orgName, address: f.address, lat: Number(f.lat), lng: Number(f.lng) };
          if (f.role === 'ngo') payload.org.dailyCapacityMeals = Number(f.capacity);
        }
      }
      await register(payload);
    } catch (err) {
      setErrors(err.fieldErrors || {});
      setFormError(err.message);
      setBusy(false);
    }
  };

  const needsOrg = f.role !== 'volunteer';
  return (
    <AuthShell>
      <h2 className="text-2xl font-bold">Create an account</h2>
      {formError && (
        <Alert tone="error" className="mt-4">
          {formError}
        </Alert>
      )}
      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <fieldset>
          <legend className="label">I am a…</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ROLES.map((r) => (
              <label key={r.value} className={`cursor-pointer rounded-lg border p-3 text-sm ${f.role === r.value ? 'border-brand-600 bg-brand-50' : 'border-stone-300 bg-white'}`}>
                <input type="radio" name="role" value={r.value} checked={f.role === r.value} onChange={set('role')} className="mr-2 accent-brand-700" />
                <span className="font-semibold">{r.label}</span>
                <span className="mt-1 block text-xs text-stone-600">{r.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Your name" required error={errors.name}>
          {(p) => <input {...p} className="input" autoComplete="name" maxLength={80} value={f.name} onChange={set('name')} />}
        </Field>
        <Field label="Email" required error={errors.email}>
          {(p) => <input {...p} className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} />}
        </Field>
        <Field label="Password" required error={errors.password} hint="At least 8 characters.">
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />}
        </Field>

        {needsOrg && (
          <fieldset className="card space-y-4 p-4">
            <legend className="px-1 text-sm font-semibold">Your organization</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="orgMode" value="new" checked={f.orgMode === 'new'} onChange={set('orgMode')} className="accent-brand-700" />
                Register a new organization
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="orgMode" value="join" checked={f.orgMode === 'join'} onChange={set('orgMode')} className="accent-brand-700" />
                Join one with a code
              </label>
            </div>
            {f.orgMode === 'join' ? (
              <Field label="Join code" required error={errors.joinCode} hint="A colleague can find it on their Organization page.">
                {(p) => <input {...p} className="input uppercase" autoComplete="off" maxLength={20} value={f.joinCode} onChange={set('joinCode')} />}
              </Field>
            ) : (
              <>
                <Field label="Organization name" required error={errors['org.name']}>
                  {(p) => <input {...p} className="input" maxLength={120} value={f.orgName} onChange={set('orgName')} />}
                </Field>
                <Field label="Address" required error={errors['org.address']} hint="Filled from the map when empty, or type it yourself.">
                  {(p) => <input {...p} className="input" autoComplete="street-address" maxLength={300} value={f.address} onChange={set('address')} />}
                </Field>
                <LocationPicker
                  lat={f.lat}
                  lng={f.lng}
                  address={f.address}
                  errors={errors}
                  errorKeys={{ lat: 'org.lat', lng: 'org.lng', address: 'org.address' }}
                  onChange={(patch) => setF((prev) => ({ ...prev, ...patch }))}
                />
                {f.role === 'ngo' && (
                  <Field label="Meals you can accept per day" required error={errors['org.dailyCapacityMeals']} hint="Claims are limited to this amount per 24 hours, so food is shared fairly.">
                    {(p) => <input {...p} className="input" type="number" min="1" max="100000" inputMode="numeric" value={f.capacity} onChange={set('capacity')} />}
                  </Field>
                )}
                <p className="text-xs text-stone-600">An administrator verifies new organizations before they can {f.role === 'donor' ? 'post' : 'claim'} food.</p>
              </>
            )}
          </fieldset>
        )}

        <Button type="submit" busy={busy} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-sm text-stone-700">
        Already have an account?{' '}
        <Link className="link" to="/login">
          Sign in
        </Link>
        {' · '}
        <Link className="link" to="/">
          Home
        </Link>
      </p>
    </AuthShell>
  );
}

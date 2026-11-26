import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Layout.jsx';
import { Alert, Button, Field } from '../components/ui.jsx';
import { homeFor, useAuth } from '../state/auth.jsx';

/** 120 -> "2 hours", 90 -> "90 minutes". */
const idleLabel = (minutes) => (minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`);

export function AuthShell({ children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="flex flex-col justify-between gap-8 bg-brand-800 p-6 text-white sm:p-10">
        <Link to="/" aria-label="RescuePlate home">
          <Logo light />
        </Link>
        <div className="max-w-md">
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">Good food should reach people, not the bin.</h1>
          <p className="mt-2 text-lg font-semibold text-amber-300" lang="bn">
            খাবার নষ্ট নয়, পৌঁছে যাক মানুষের কাছে
          </p>
          <p className="mt-4 text-brand-50">
            Restaurants, community centres and hall canteens in Dhaka post surplus food with its safe-until time. Nearby shelters and NGOs claim it live, volunteers collect it, and every meal is tracked until it is delivered.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-white/20 pt-6 text-sm">
            <div>
              <dt className="text-brand-100">Wasted in Bangladeshi homes each year</dt>
              <dd className="text-xl font-bold">14.1 m tonnes</dd>
            </div>
            <div>
              <dt className="text-brand-100">Per person each year</dt>
              <dd className="text-xl font-bold">82 kg</dd>
            </div>
            <div>
              <dt className="text-brand-100">Of the world’s food is wasted</dt>
              <dd className="text-xl font-bold">19%</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-brand-100">Source: UNEP Food Waste Index Report 2024 (household estimates for Bangladesh; global figure for 2022).</p>
        </div>
        <p className="text-xs text-brand-100">Hack the Vibe 2026 · World Problem Solver track</p>
      </aside>
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

export default function Login() {
  const { login, demoLogin, config, expired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const go = (user) => navigate(location.state?.from || homeFor(user?.role), { replace: true });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy('password');
    setError(null);
    try {
      go(await login(form.email, form.password));
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  };

  const persona = async (key) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      go(await demoLogin(key, accessCode || undefined));
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  };

  return (
    <AuthShell>
      <h2 className="text-2xl font-bold">Sign in</h2>
      {expired && (
        <Alert tone="warning" className="mt-4">
          Your session ended. Please sign in again.
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mt-4">
          {error.message}
        </Alert>
      )}

      {config?.demoMode && (
        <section className="card mt-5 p-4" aria-labelledby="personas-title">
          <h3 id="personas-title" className="font-semibold">
            Try it as…
          </h3>
          <p className="mt-0.5 text-sm text-stone-600">One click signs you in with a demo account. Open two browser windows to see live updates between roles.</p>
          {config.demoAutoResetMinutes > 0 && (
            <p className="mt-1 text-xs text-stone-600">
              The sample data restores itself after {idleLabel(config.demoAutoResetMinutes)} with no changes, so there is always fresh food to claim. Accounts you register are kept.
            </p>
          )}
          {config.demoAccessCodeRequired && (
            <Field label="Demo access code" className="mt-3">
              {(p) => <input {...p} className="input" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} autoComplete="off" />}
            </Field>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {config.personas.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => persona(p.key)}
                disabled={Boolean(busy)}
                aria-busy={busy === p.key || undefined}
                className="rounded-lg border border-stone-300 bg-white p-3 text-left hover:border-brand-600 hover:bg-brand-50 disabled:opacity-60"
              >
                <span className="block text-sm font-bold text-brand-800">{busy === p.key ? 'Signing in…' : p.label}</span>
                <span className="block text-xs text-stone-700">
                  {p.name}
                  {p.org ? ` · ${p.org}` : ''}
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">{p.hint}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="Email" required>
          {(p) => <input {...p} className="input" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Password" required>
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <Button type="submit" busy={busy === 'password'} disabled={Boolean(busy) || !form.email || !form.password} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-sm text-stone-700">
        New here?{' '}
        <Link className="link" to="/register">
          Create an account
        </Link>
        {' · '}
        <Link className="link" to="/">
          Home
        </Link>
      </p>
    </AuthShell>
  );
}

import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { duration } from '../lib/format.js';
import { useClock, useConnection } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';
import { Alert, Button } from './ui.jsx';

const NAV = {
  donor: [
    { to: '/listings', label: 'My listings' },
    { to: '/claims', label: 'Incoming claims' },
    { to: '/feed', label: 'Live feed' },
    { to: '/impact', label: 'Impact' },
    { to: '/org', label: 'Organization' },
  ],
  ngo: [
    { to: '/feed', label: 'Live feed' },
    { to: '/claims', label: 'My claims' },
    { to: '/impact', label: 'Impact' },
    { to: '/org', label: 'Organization' },
  ],
  volunteer: [
    { to: '/pickups', label: 'Pickups' },
    { to: '/feed', label: 'Live feed' },
    { to: '/impact', label: 'Impact' },
  ],
  admin: [
    { to: '/admin', label: 'Admin' },
    { to: '/demo', label: 'Demo console', demoOnly: true },
    { to: '/feed', label: 'Live feed' },
    { to: '/claims', label: 'All claims' },
    { to: '/impact', label: 'Impact' },
  ],
};

export function Logo({ light = false }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill={light ? '#fff' : '#065f46'} />
        <circle cx="16" cy="16" r="9" fill="none" stroke={light ? '#065f46' : '#fff'} strokeWidth="2.2" />
        <path d="M11.5 16.2l3.1 3.1 6-6.4" fill="none" stroke="#f59e0b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`text-lg font-extrabold tracking-tight ${light ? 'text-white' : 'text-brand-900'}`}>RescuePlate</span>
    </span>
  );
}

function ConnectionStatus() {
  const { status } = useConnection();
  const view = {
    online: { dot: 'bg-brand-500', text: 'Live', title: 'Connected. Changes by other users appear instantly.' },
    connecting: { dot: 'bg-amber-500 animate-pulse', text: 'Connecting…', title: 'Opening the live connection.' },
    reconnecting: { dot: 'bg-amber-500 animate-pulse', text: 'Reconnecting…', title: 'Live connection lost. Retrying; data will refresh automatically.' },
    offline: { dot: 'bg-stone-400', text: 'Offline', title: 'Not connected.' },
  }[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white" title={view.title} role="status">
      <span className={`h-2 w-2 rounded-full ${view.dot}`} aria-hidden="true" />
      {view.text}
    </span>
  );
}

export function Layout() {
  const { user, config, logout } = useAuth();
  const { status } = useConnection();
  const { offsetSeconds } = useClock();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const links = (NAV[user.role] || []).filter((l) => !l.demoOnly || config?.demoMode);

  const signOut = async () => {
    setLeaving(true);
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:font-semibold">
        Skip to main content
      </a>
      <header className="bg-brand-800 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" aria-label="RescuePlate home">
            <Logo light />
          </Link>
          <div className="flex items-center gap-3">
            <ConnectionStatus />
            <div className="hidden text-right text-xs leading-tight sm:block">
              <p className="font-semibold">{user.name}</p>
              <p className="text-brand-100">{user.org ? user.org.name : user.role === 'admin' ? 'Administrator' : 'Volunteer'}</p>
            </div>
            <Button variant="secondary" onClick={signOut} busy={leaving} className="min-h-9 px-3 py-1.5">
              Sign out
            </Button>
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-6xl overflow-x-auto px-2">
          <ul className="flex gap-1">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  className={({ isActive }) =>
                    `block whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-stone-50 text-brand-900' : 'text-brand-50 hover:bg-white/10'}`
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-6xl space-y-2 px-4 pt-3 empty:hidden">
        {status === 'reconnecting' && (
          <Alert tone="warning" title="Live connection lost">
            Trying to reconnect. What you see may be out of date; it will refresh automatically once the connection is back. Your actions are still checked by the server.
          </Alert>
        )}
        {offsetSeconds !== 0 && (
          <Alert tone="info" title="Demo clock is fast-forwarded">
            Application time is {duration(Math.abs(offsetSeconds) * 1000)} {offsetSeconds > 0 ? 'ahead of' : 'behind'} real time. An admin can reset it in the demo console.
          </Alert>
        )}
        {user.org?.status === 'PENDING' && (
          <Alert tone="warning" title="Waiting for verification">
            An administrator must verify {user.org.name} before it can {user.role === 'donor' ? 'post food' : 'claim food'}. This page updates by itself when that happens.
          </Alert>
        )}
        {user.org?.status === 'SUSPENDED' && (
          <Alert tone="error" title="Organization suspended">
            {user.org.name} has been suspended and cannot post or claim food. Contact an administrator.
          </Alert>
        )}
      </div>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-5" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 py-4 text-center text-xs text-stone-500">
        RescuePlate · Hack the Vibe 2026 · World Problem Solver track
      </footer>
    </div>
  );
}

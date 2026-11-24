import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthorized } from '../lib/api.js';
import { connectRealtime, disconnectRealtime, setServerClock, useLive } from '../lib/realtime.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, config: null, error: null });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/me');
      setServerClock(me.serverNow, me.clockOffsetSeconds);
      setState((s) => ({ ...s, status: 'in', user: me.user, error: null, signedOutByUser: false }));
      return me.user;
    } catch (err) {
      if (err.status === 401) setState((s) => ({ ...s, status: 'out', user: null, error: null }));
      else setState((s) => (s.status === 'loading' ? { ...s, status: 'error', error: err.message } : s));
      return null;
    }
  }, []);

  // First load: public configuration, then the current session (if any).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await api.get('/config');
        if (!cancelled) setState((s) => ({ ...s, config }));
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, status: 'error', error: err.message }));
        return;
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Any API call that comes back 401 (expired, revoked or suspended) signs the UI out.
  useEffect(() => onUnauthorized(() => setState((s) => (s.status === 'in' ? { ...s, status: 'out', user: null, expired: true } : s))), []);

  // Hold a live connection only while signed in.
  const signedIn = state.status === 'in';
  useEffect(() => {
    if (!signedIn) return undefined;
    connectRealtime({ onAuthFailure: () => api.get('/me').catch(() => {}) });
    return () => disconnectRealtime();
  }, [signedIn]);

  // Verification or suspension of my organization takes effect without a reload.
  useLive('org.changed', () => refresh());

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      retry: () => window.location.reload(),
      login: async (email, password) => {
        await api.post('/auth/login', { email, password });
        setState((s) => ({ ...s, expired: false }));
        return refresh();
      },
      demoLogin: async (persona, accessCode) => {
        await api.post('/auth/demo-login', { persona, accessCode });
        setState((s) => ({ ...s, expired: false }));
        return refresh();
      },
      register: async (input) => {
        await api.post('/auth/register', input);
        return refresh();
      },
      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        setState((s) => ({ ...s, status: 'out', user: null, expired: false, signedOutByUser: true }));
      },
    }),
    [state, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Where each role lands after signing in. */
export const homeFor = (role) => ({ donor: '/listings', ngo: '/feed', volunteer: '/pickups', admin: '/admin' })[role] || '/feed';

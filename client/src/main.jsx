import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { Alert, Button, Loading } from './components/ui.jsx';
import './index.css';
import Admin from './pages/Admin.jsx';
import Claims from './pages/Claims.jsx';
import Demo from './pages/Demo.jsx';
import Feed from './pages/Feed.jsx';
import Impact from './pages/Impact.jsx';
import Landing from './pages/Landing.jsx';
import ListingDetail from './pages/ListingDetail.jsx';
import ListingNew from './pages/ListingNew.jsx';
import Login from './pages/Login.jsx';
import Org from './pages/Org.jsx';
import Pickups from './pages/Pickups.jsx';
import Register from './pages/Register.jsx';
import { AuthProvider, homeFor, useAuth } from './state/auth.jsx';
import { ToastProvider } from './state/toast.jsx';

/** A rendering bug shows a recovery screen instead of a blank page. */
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('UI error', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert tone="error" title="Something went wrong on this page">
          Your data is safe. Reload to continue.
        </Alert>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

/** Client-side route guard. The server enforces the same rules on every API call. */
function RequireRole({ roles, children }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? children : <Navigate to={homeFor(user.role)} replace />;
}
const guard = (roles, element) => <RequireRole roles={roles}>{element}</RequireRole>;

/** Already signed in on /login or /register: continue to the page originally requested, or home. */
function AfterLogin() {
  const { user } = useAuth();
  const location = useLocation();
  return <Navigate to={location.state?.from || homeFor(user.role)} replace />;
}

/** Signed-out visitors hitting an app URL are sent to sign-in (with return path). */
function ToLogin() {
  const { signedOutByUser } = useAuth();
  const location = useLocation();
  // After a deliberate sign-out the next person starts at their own home page, not the previous user's page.
  return <Navigate to="/login" replace state={signedOutByUser ? null : { from: location.pathname + location.search }} />;
}

function App() {
  const { status, user, error, retry } = useAuth();
  if (status === 'loading') return <Loading label="Starting RescuePlate…" />;
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert tone="error" title="RescuePlate could not be reached">
          {error}
        </Alert>
        <Button className="mt-4" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }
  const signedIn = status === 'in';
  return (
    <Routes>
      <Route path="/" element={signedIn ? <Navigate to={homeFor(user.role)} replace /> : <Landing />} />
      <Route path="/login" element={signedIn ? <AfterLogin /> : <Login />} />
      <Route path="/register" element={signedIn ? <AfterLogin /> : <Register />} />
      {signedIn ? (
        <Route element={<Layout />}>
          <Route path="/feed" element={<Feed mode="browse" />} />
          <Route path="/listings" element={guard(['donor'], <Feed mode="mine" />)} />
          <Route path="/listings/new" element={guard(['donor'], <ListingNew />)} />
          <Route path="/listings/:id" element={<ListingDetail />} />
          <Route path="/claims" element={guard(['donor', 'ngo', 'admin'], <Claims />)} />
          <Route path="/pickups" element={guard(['volunteer'], <Pickups />)} />
          <Route path="/impact" element={<Impact />} />
          <Route path="/org" element={guard(['donor', 'ngo'], <Org />)} />
          <Route path="/admin" element={guard(['admin'], <Admin />)} />
          <Route path="/demo" element={guard(['admin'], <Demo />)} />
          <Route path="*" element={<NotFound />} />
        </Route>
      ) : (
        <Route path="*" element={<ToLogin />} />
      )}
    </Routes>
  );
}

function NotFound() {
  const { user } = useAuth();
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="mt-2 text-sm text-stone-600">That address does not exist.</p>
      <a className="link mt-4 inline-block" href={homeFor(user.role)}>
        Go to your home page
      </a>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

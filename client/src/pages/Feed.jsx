import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClaimDialog } from '../components/ClaimDialog.jsx';
import { ListingCard } from '../components/ListingCard.jsx';
import { Button, EmptyState, Field, LoadError, Loading, PageHeader, Pagination, useLoad } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { FOOD_LABELS, LISTING_STATUS, number } from '../lib/format.js';
import { applyListing, useLive } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';

const SORTS = [
  { value: 'expiry:asc', label: 'Expiring soonest' },
  { value: 'expiry:desc', label: 'Expiring latest' },
  { value: 'meals:desc', label: 'Most meals' },
  { value: 'meals:asc', label: 'Fewest meals' },
  { value: 'newest:desc', label: 'Newest first' },
  { value: 'distance:asc', label: 'Nearest first' },
];

/**
 * The live feed ("browse") and a donor's own listings ("mine").
 * Filters live in the URL, so a filtered view can be bookmarked and survives a refresh.
 */
export default function Feed({ mode }) {
  const { user } = useAuth();
  const mine = mode === 'mine';
  const [params, setParams] = useSearchParams();
  const get = (k, fallback = '') => params.get(k) ?? fallback;
  const filters = {
    q: get('q'),
    foodType: get('foodType'),
    veg: get('veg'),
    status: get('status', mine ? 'all' : 'available'),
    minMeals: get('minMeals'),
    withinMinutes: get('withinMinutes'),
    maxKm: get('maxKm'),
    sort: get('sort', mine ? 'newest:desc' : 'expiry:asc'),
    page: Number(get('page', '1')) || 1,
  };
  const setFilter = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === '' || v == null ? next.delete(k) : next.set(k, String(v));
    if (!('page' in patch)) next.delete('page'); // any filter change returns to page 1
    setParams(next, { replace: true });
  };

  // The search box updates the URL shortly after typing stops.
  const [qInput, setQInput] = useState(filters.q);
  useEffect(() => {
    if (qInput === filters.q) return undefined;
    const t = setTimeout(() => setFilter({ q: qInput.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const [sort, order] = filters.sort.split(':');
  const query = qs({ ...filters, sort, order, mine: mine ? 'true' : undefined, pageSize: 12 });
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/listings${query}`), [query]);

  /* ----------------------------- live updates ----------------------------- */
  const [claiming, setClaiming] = useState(null);
  const [flash, setFlash] = useState({});
  const [announce, setAnnounce] = useState('');
  const refetchTimer = useRef(null);
  const refetchSoon = () => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => reload({ silent: true }), 600);
  };
  useEffect(() => () => clearTimeout(refetchTimer.current), []);

  useLive('listing.upsert', ({ listing, created }) => {
    // 1. Patch the card (and an open claim dialog) in place immediately; the higher version wins.
    setData((d) => (d ? { ...d, items: applyListing(d.items, listing) } : d));
    setClaiming((c) => (c && c.id === listing.id && listing.version > c.version ? { ...listing, distanceKm: c.distanceKm } : c));
    if (data?.items.some((i) => i.id === listing.id && listing.version > i.version)) {
      setFlash((f) => ({ ...f, [listing.id]: Date.now() }));
      setAnnounce(`${listing.title}: ${listing.remainingMeals} meals left.`);
    } else if (created) {
      setAnnounce(`New listing from ${listing.donor.name}: ${listing.title}.`);
    }
    // 2. Then refresh ordering, totals and newly matching listings from the server.
    refetchSoon();
  });
  useLive('listing.removed', ({ id }) => {
    setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== id) } : d));
    refetchSoon();
  });
  // After a reconnect (or a demo reset) take a fresh snapshot instead of trusting local state.
  useLive('resync', () => reload({ silent: true }));

  const fromList = claiming && data?.items.find((i) => i.id === claiming.id);
  const claimingLive = fromList && fromList.version > claiming.version ? fromList : claiming;
  const canClaim = user.role === 'ngo' && user.org?.status === 'VERIFIED';
  const canPost = user.role === 'donor' && user.org?.status === 'VERIFIED';
  const hasFilters = ['q', 'foodType', 'veg', 'status', 'minMeals', 'withinMinutes', 'maxKm'].some((k) => params.has(k));
  const canMeasureDistance = Boolean(user.org) && !mine; // distance to your own kitchen is always zero
  const [showFilters, setShowFilters] = useState(false);
  const more = showFilters ? '' : 'hidden sm:block';

  return (
    <>
      <PageHeader title={mine ? 'My listings' : 'Live feed'} subtitle={mine ? `Surplus food posted by ${user.org.name}.` : 'Surplus food available right now. Updates appear the moment anything changes.'}>
        {user.role === 'donor' && (
          <Link
            to="/listings/new"
            aria-disabled={!canPost}
            onClick={(e) => !canPost && e.preventDefault()}
            className={`inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-semibold text-white ${canPost ? 'bg-brand-700 hover:bg-brand-800' : 'cursor-not-allowed bg-brand-700/50'}`}
          >
            Post surplus food
          </Link>
        )}
      </PageHeader>

      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Filter listings" onSubmit={(e) => e.preventDefault()}>
        <Field label="Search" className="sm:col-span-2">
          {(p) => <input {...p} className="input" type="search" placeholder="Food, donor or area" maxLength={100} value={qInput} onChange={(e) => setQInput(e.target.value)} />}
        </Field>
        {/* On phones the other filters fold away so the food itself is visible first. */}
        <Button variant="secondary" className="sm:hidden" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
          {showFilters ? 'Hide filters' : `Filters and sorting${hasFilters ? ' (active)' : ''}`}
        </Button>
        <Field label="Status" className={more}>
          {(p) => (
            <select {...p} className="input" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
              <option value="available">Available now</option>
              <option value="all">All statuses</option>
              {Object.entries(LISTING_STATUS).map(([value, s]) => (
                <option key={value} value={value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Sort by" className={more}>
          {(p) => (
            <select {...p} className="input" value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value })}>
              {SORTS.filter((s) => canMeasureDistance || !s.value.startsWith('distance')).map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Food type" className={more}>
          {(p) => (
            <select {...p} className="input" value={filters.foodType} onChange={(e) => setFilter({ foodType: e.target.value })}>
              <option value="">Any type</option>
              {Object.entries(FOOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Contains" className={more}>
          {(p) => (
            <select {...p} className="input" value={filters.veg} onChange={(e) => setFilter({ veg: e.target.value })}>
              <option value="">Any</option>
              <option value="veg">Vegetarian only</option>
              <option value="nonveg">With meat, fish or egg</option>
            </select>
          )}
        </Field>
        <Field label="Time left" className={more}>
          {(p) => (
            <select {...p} className="input" value={filters.withinMinutes} onChange={(e) => setFilter({ withinMinutes: e.target.value })}>
              <option value="">Any</option>
              <option value="60">Expiring within 1 hour</option>
              <option value="180">Expiring within 3 hours</option>
            </select>
          )}
        </Field>
        {canMeasureDistance ? (
          <Field label={`Distance from ${user.org.name}`} className={more}>
            {(p) => (
              <select {...p} className="input" value={filters.maxKm} onChange={(e) => setFilter({ maxKm: e.target.value })}>
                <option value="">Any distance</option>
                <option value="2">Within 2 km</option>
                <option value="5">Within 5 km</option>
                <option value="10">Within 10 km</option>
              </select>
            )}
          </Field>
        ) : (
          <Field label="At least (meals)" className={more}>
            {(p) => (
              <select {...p} className="input" value={filters.minMeals} onChange={(e) => setFilter({ minMeals: e.target.value })}>
                <option value="">Any amount</option>
                <option value="20">20 or more</option>
                <option value="50">50 or more</option>
              </select>
            )}
          </Field>
        )}
        {hasFilters && (
          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            <Button
              variant="ghost"
              onClick={() => {
                setQInput('');
                setParams({}, { replace: true });
              }}
            >
              Clear all filters
            </Button>
          </div>
        )}
      </form>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {error ? (
        <LoadError error={error} onRetry={() => reload()} />
      ) : !data ? (
        <Loading label="Loading listings…" />
      ) : (
        <div aria-busy={loading}>
          <p className="mb-3 text-sm text-stone-700" role="status">
            <span className="tabular font-bold">{number(data.total)}</span> {data.total === 1 ? 'listing' : 'listings'} ·{' '}
            <span className="tabular font-bold">{number(data.summary.mealsAvailable)}</span> meals remaining from <span className="tabular font-bold">{data.summary.donors}</span>{' '}
            {data.summary.donors === 1 ? 'donor' : 'donors'}
          </p>
          {data.items.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'No listings match these filters' : mine ? 'You have not posted any food yet' : 'No food is available right now'}
              action={
                hasFilters ? (
                  <Button variant="secondary" onClick={() => (setQInput(''), setParams({}, { replace: true }))}>
                    Clear filters
                  </Button>
                ) : null
              }
            >
              {hasFilters ? 'Try a wider search.' : mine ? 'Post surplus food and nearby NGOs will see it instantly.' : 'New listings appear here automatically. There is no need to refresh.'}
            </EmptyState>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((l) => (
                <ListingCard key={`${l.id}:${flash[l.id] || 0}`} listing={l} flash={Boolean(flash[l.id])} canClaim={canClaim && !mine} onClaim={setClaiming} manage={mine} />
              ))}
            </ul>
          )}
          <Pagination page={data.page} totalPages={data.totalPages} onPage={(page) => setFilter({ page })} />
        </div>
      )}

      {claimingLive && <ClaimDialog listing={claimingLive} onClose={() => setClaiming(null)} onClaimed={() => reload({ silent: true })} />}
    </>
  );
}

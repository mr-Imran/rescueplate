import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClaimDialog } from '../components/ClaimDialog.jsx';
import { ConflictDialog } from '../components/ConflictDialog.jsx';
import { DietBadge, displayStatus, isClaimable, MealsBar } from '../components/ListingCard.jsx';
import { ListingForm, validateListing } from '../components/ListingForm.jsx';
import { LocationMap } from '../components/LocationMap.jsx';
import { Alert, Badge, Button, ConfirmDialog, Countdown, LoadError, Loading, useLoad, useNow } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { ago, auditLabel, CLAIM_STATUS, clockTime, FIELD_LABELS, FOOD_LABELS, fullTime, meals as mealsText } from '../lib/format.js';
import { changedFields, threeWayMerge } from '../lib/merge.js';
import { sendLive, useLive } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

const toForm = (l) => ({ title: l.title, description: l.description, foodType: l.foodType, isVeg: l.isVeg, totalMeals: String(l.totalMeals), preparedAt: l.preparedAt, safeUntil: l.safeUntil });
const fromForm = (v) => ({ ...v, title: v.title.trim(), totalMeals: Number(v.totalMeals) });

export default function ListingDetail() {
  const { id } = useParams();
  const { user, config } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow(1000);

  const { data, error, reload, setData } = useLoad(() => api.get(`/listings/${id}`), [id]);
  const listing = data?.listing;
  const isOwner = Boolean(data?.canEdit);
  const seesClaims = isOwner || user.role === 'admin';
  const claims = useLoad(() => (seesClaims ? api.get(`/claims?listingId=${id}`).then((d) => d.items) : Promise.resolve([])), [id, seesClaims]);

  const [removed, setRemoved] = useState(false);
  const [changedBy, setChangedBy] = useState(false);

  /* ------------------------------- editing ------------------------------- */
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState(null); // the version the form was opened with
  const [values, setValues] = useState(null);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [editors, setEditors] = useState([]);
  const editingRef = useRef(false);

  const startEdit = () => {
    setBase(listing);
    setValues(toForm(listing));
    setErrors({});
    setFailure(null);
    setChangedBy(false);
    setEditing(true);
  };
  const stopEdit = () => {
    setEditing(false);
    setConflict(null);
    setSaving(false);
  };

  // Presence: tell colleagues this listing is open for editing, and stop when done or leaving.
  useEffect(() => {
    if (!editing) return undefined;
    editingRef.current = true;
    sendLive('presence:editing', { listingId: id, editing: true });
    return () => {
      editingRef.current = false;
      sendLive('presence:editing', { listingId: id, editing: false });
    };
  }, [editing, id]);
  useLive('presence.editing', (p) => p.listingId === id && setEditors(p.editors.filter((e) => e.userId !== user.id)));

  /* ----------------------------- live updates ----------------------------- */
  useLive('listing.upsert', ({ listing: incoming }) => {
    if (incoming.id !== id) return;
    setData((d) => (d && incoming.version > d.listing.version ? { ...d, listing: incoming } : d));
    if (editingRef.current && base && incoming.version > base.version) setChangedBy(true);
    reload({ silent: true }); // history and my-claims
  });
  useLive('listing.removed', (p) => p.id === id && setRemoved(true));
  useLive('claim.changed', (p) => {
    if (p.listingId !== id) return;
    claims.reload({ silent: true });
    reload({ silent: true });
  });
  useLive('resync', () => {
    reload({ silent: true });
    claims.reload({ silent: true });
    if (editingRef.current) sendLive('presence:editing', { listingId: id, editing: true });
  });

  /**
   * Saves with optimistic concurrency. The request carries the version the edit
   * was based on. If the server has a newer version it answers 409 with the
   * latest data, and we merge field by field:
   *   - no field changed by both sides  -> re-apply automatically on the latest version
   *   - a field changed by both sides   -> ask the user (ConflictDialog)
   */
  const attemptSave = async (onto, mine, attempt = 0, merged = false) => {
    const patch = changedFields(onto, mine);
    setSaving(true);
    try {
      let saved = onto;
      if (Object.keys(patch).length > 0) saved = (await api.patch(`/listings/${id}`, { expectedVersion: onto.version, ...patch })).listing;
      setData((d) => (d ? { ...d, listing: saved.version >= d.listing.version ? saved : d.listing } : d));
      stopEdit();
      if (merged === 'chosen') toast.success('Your choices were saved on top of the latest version.', { title: 'Conflict resolved' });
      else if (merged) toast.success('Someone else had also changed this listing. Both sets of changes were kept.', { title: 'Saved and merged' });
      else if (Object.keys(patch).length === 0) toast.info('There were no changes to save.');
      else toast.success('Everyone watching sees the update now.', { title: 'Changes saved' });
      reload({ silent: true });
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT') {
        const theirs = err.details.current;
        const result = threeWayMerge(onto, mine, theirs);
        setData((d) => (d && theirs.version > d.listing.version ? { ...d, listing: theirs } : d));
        if (result.conflicts.length === 0 && attempt < 3) return attemptSave(theirs, result.merged, attempt + 1, merged || true);
        if (result.conflicts.length === 0) setFailure({ message: 'This listing is changing very quickly. Please review it and save again.' });
        else setConflict({ ...result, theirs, lastChange: err.details.lastChange });
        setBase(theirs);
        setValues(toForm({ ...theirs, ...result.merged }));
      } else {
        setErrors(err.fieldErrors);
        setFailure(err);
      }
      setSaving(false);
    }
    return undefined;
  };

  const save = () => {
    const claimed = listing.totalMeals - listing.remainingMeals;
    const found = validateListing(values, config.foodTypes, { isNew: false, claimedMeals: claimed });
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    attemptSave(base, fromForm(values));
  };

  const resolveConflict = (choice) => {
    const final = { ...conflict.merged };
    for (const c of conflict.conflicts) final[c.field] = choice[c.field] === 'mine' ? c.mine : c.theirs;
    const onto = conflict.theirs;
    setConflict(null);
    attemptSave(onto, final, 0, 'chosen');
  };

  /* ------------------------- cancel / delete / claim ------------------------ */
  const [confirm, setConfirm] = useState(null); // 'cancel' | 'delete'
  const [acting, setActing] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  const act = async (kind) => {
    setActing(true);
    try {
      if (kind === 'cancel') {
        const res = await api.post(`/listings/${id}/cancel`, { expectedVersion: listing.version });
        setData((d) => ({ ...d, listing: res.listing }));
        toast.success('The listing was withdrawn from the feed.', { title: 'Listing cancelled' });
      } else {
        await api.del(`/listings/${id}`);
        toast.success('The listing was deleted.');
        navigate('/listings', { replace: true });
      }
      setConfirm(null);
    } catch (err) {
      setConfirm(null);
      toast.fromError(err, kind === 'cancel' ? 'Could not cancel' : 'Could not delete');
      reload({ silent: true });
    } finally {
      setActing(false);
    }
  };

  if (removed) {
    return (
      <Alert tone="warning" title="This listing was deleted">
        The donor removed it.{' '}
        <Link className="link" to="/feed">
          Back to the live feed
        </Link>
      </Alert>
    );
  }
  if (error) return error.status === 404 ? <Alert tone="warning" title="Listing not found">It may have been deleted. <Link className="link" to="/feed">Back to the live feed</Link></Alert> : <LoadError error={error} onRetry={() => reload()} />;
  if (!listing) return <Loading label="Loading listing…" />;

  const status = displayStatus(listing, now);
  const claimable = isClaimable(listing, now);
  const claimedMeals = listing.totalMeals - listing.remainingMeals;
  const closed = ['COMPLETED', 'EXPIRED', 'CANCELLED'].includes(listing.status) || new Date(listing.safeUntil).getTime() <= now;
  const openClaims = (claims.data || []).filter((c) => ['CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP'].includes(c.status)).length;
  const hasHistory = (claims.data || []).length > 0;
  const myOpenClaim = data.myClaims?.find((c) => ['CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP'].includes(c.status));
  const canClaim = user.role === 'ngo' && user.org?.status === 'VERIFIED';

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="card p-5" aria-labelledby="listing-title">
        <p className="mb-2 text-sm">
          <Link className="link" to={isOwner ? '/listings' : '/feed'}>
            ← {isOwner ? 'My listings' : 'Live feed'}
          </Link>
        </p>
        {editing ? (
          <>
            <h1 id="listing-title" className="mb-4 text-xl font-bold">
              Edit listing
            </h1>
            {editors.length > 0 && (
              <Alert tone="info" className="mb-4">
                <strong>{editors.map((e) => e.name).join(', ')}</strong> {editors.length === 1 ? 'is' : 'are'} also editing this listing right now. If you both change the same field, you will be asked which value to keep.
              </Alert>
            )}
            {changedBy && !conflict && (
              <Alert tone="warning" className="mb-4">
                This listing changed while you were editing (now {mealsText(listing.remainingMeals)} left). When you save, your changes are merged with the latest version.
              </Alert>
            )}
            {failure && (
              <Alert tone="error" title="Not saved" className="mb-4">
                {failure.message}
              </Alert>
            )}
            <ListingForm
              values={values}
              onChange={setValues}
              errors={errors}
              onSubmit={save}
              busy={saving}
              submitLabel="Save changes"
              onCancel={stopEdit}
              frozen={claimedMeals > 0 || hasHistory ? ['foodType', 'isVeg', 'preparedAt'] : []}
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 id="listing-title" className="min-w-0 break-words text-2xl font-bold">
                {listing.title}
              </h1>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="mt-1 text-stone-700">
              {listing.donor.name} · {listing.donor.address}
              {listing.distanceKm != null && ` · ${listing.distanceKm} km away`}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <DietBadge isVeg={listing.isVeg} />
              <Badge>{FOOD_LABELS[listing.foodType]}</Badge>
            </div>
            {listing.description && <p className="mt-4 whitespace-pre-line break-words text-stone-800">{listing.description}</p>}
            <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-stone-500">Prepared</dt>
                <dd className="font-medium">{clockTime(listing.preparedAt, now)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Safe to eat until</dt>
                <dd className="font-medium">{clockTime(listing.safeUntil, now)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Posted</dt>
                <dd className="font-medium">{ago(listing.createdAt, now)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Last change</dt>
                <dd className="font-medium">
                  {ago(listing.updatedAt, now)} <span className="text-stone-500">(version {listing.version})</span>
                </dd>
              </div>
            </dl>
            {Number.isFinite(listing.donor?.lat) && Number.isFinite(listing.donor?.lng) && (
              <div className="mt-5">
                <p className="mb-2 text-sm font-medium text-stone-800">Pickup location</p>
                <LocationMap
                  lat={listing.donor.lat}
                  lng={listing.donor.lng}
                  markers={[{ lat: listing.donor.lat, lng: listing.donor.lng, label: 'Collect', color: '#b45309', popup: `${listing.donor.name}<br>${listing.donor.address}` }]}
                  height="12rem"
                />
              </div>
            )}
          </>
        )}
      </section>

      <aside className="space-y-4">
        <div className="card space-y-3 p-5">
          <MealsBar listing={listing} />
          <p className="text-sm text-stone-700" aria-live="polite">
            {closed ? `Closed · was safe until ${clockTime(listing.safeUntil, now)}` : <>Safe for <Countdown until={listing.safeUntil} /></>}
          </p>
          {canClaim && !myOpenClaim && (
            <Button className="w-full" onClick={() => setClaimOpen(true)} disabled={!claimable}>
              {claimable ? 'Claim meals' : 'Not available'}
            </Button>
          )}
          {myOpenClaim && (
            <Alert tone="success">
              Your organization holds {mealsText(myOpenClaim.meals)} here.{' '}
              <Link className="link" to="/claims">
                Manage the claim
              </Link>
            </Alert>
          )}
          {user.role === 'ngo' && user.org?.status !== 'VERIFIED' && <Alert tone="warning">Your organization must be verified before it can claim food.</Alert>}
          {isOwner && !editing && (
            <div className="flex flex-col gap-2">
              <Button onClick={startEdit} disabled={closed} title={closed ? 'Closed listings cannot be edited' : undefined}>
                Edit listing
              </Button>
              <Button variant="danger" onClick={() => setConfirm('cancel')} disabled={closed || openClaims > 0} title={openClaims > 0 ? 'NGOs still have open claims on this listing' : undefined}>
                Cancel listing
              </Button>
              {openClaims > 0 && !closed && <p className="text-xs text-stone-600">Cannot be cancelled while {openClaims === 1 ? 'an NGO claim is' : `${openClaims} NGO claims are`} open.</p>}
              {!hasHistory && !claims.loading && (
                <Button variant="ghost" onClick={() => setConfirm('delete')}>
                  Delete permanently
                </Button>
              )}
            </div>
          )}
        </div>

        {seesClaims && (
          <section className="card p-5" aria-labelledby="claims-title">
            <h2 id="claims-title" className="font-bold">
              Claims on this listing
            </h2>
            {claims.error ? (
              <p className="mt-2 text-sm text-red-700">Could not load claims.</p>
            ) : (claims.data || []).length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">No NGO has claimed this food yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {claims.data.map((c) => (
                  <li key={c.id} className="rounded-lg border border-stone-200 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{c.ngo.name}</p>
                      <Badge tone={CLAIM_STATUS[c.status].tone}>{CLAIM_STATUS[c.status].label}</Badge>
                    </div>
                    <p className="text-stone-700">
                      {mealsText(c.meals)}
                      {c.volunteer && ` · volunteer ${c.volunteer.name}`}
                    </p>
                    {c.handoverCode && (
                      <p className="mt-2 rounded bg-amber-50 p-2 text-amber-900">
                        Handover code: <span className="tabular font-mono text-lg font-bold tracking-widest">{c.handoverCode}</span>
                        <span className="block text-xs">Read this to the volunteer when they collect the food.</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {data.history?.length > 0 && (
          <section className="card p-5" aria-labelledby="history-title">
            <h2 id="history-title" className="font-bold">
              Activity
            </h2>
            <ol className="mt-3 space-y-2 text-sm">
              {data.history.map((h) => (
                <li key={h.id} className="border-l-2 border-stone-200 pl-3">
                  <span className="font-medium">{h.actor}</span> {auditLabel(h.action)}
                  {h.meta?.granted != null && ` (${mealsText(h.meta.granted)})`}
                  {h.meta?.changed && ` (${h.meta.changed.map((f) => (FIELD_LABELS[f] || f).toLowerCase()).join(', ')})`}
                  <span className="block text-xs text-stone-500" title={fullTime(h.at)}>
                    {ago(h.at, now)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </aside>

      {conflict && <ConflictDialog conflict={conflict} onResolve={resolveConflict} onDiscard={stopEdit} busy={saving} />}
      {claimOpen && <ClaimDialog listing={listing} onClose={() => setClaimOpen(false)} onClaimed={() => reload({ silent: true })} />}
      <ConfirmDialog open={confirm === 'cancel'} title="Cancel this listing?" confirmLabel="Cancel listing" onConfirm={() => act('cancel')} onClose={() => setConfirm(null)} busy={acting}>
        It will be withdrawn from the live feed and cannot be reopened. {mealsText(listing.remainingMeals)} will no longer be offered.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'delete'} title="Delete this listing permanently?" confirmLabel="Delete" onConfirm={() => act('delete')} onClose={() => setConfirm(null)} busy={acting}>
        This removes the listing completely. It is only possible because nobody has claimed it.
      </ConfirmDialog>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClaimCard } from '../components/ClaimCard.jsx';
import { Alert, Button, ConfirmDialog, EmptyState, Field, LoadError, Loading, Modal, PageHeader, Tabs, useLoad } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { meals as mealsText } from '../lib/format.js';
import { useLive } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

const OPEN = ['CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP'];

/** NGO: manage my claims. Donor: claims on my food (with handover codes). Admin: everything, read-only. */
export default function Claims() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('open');
  const { data, error, reload } = useLoad(() => api.get('/claims').then((d) => d.items), []);
  const [assigning, setAssigning] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(null);

  useLive('claim.changed', () => reload({ silent: true }));
  useLive('resync', () => reload({ silent: true }));

  /** Runs one action; `busy` holds its id so the button cannot be pressed twice. */
  const run = async (key, fn, success) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      toast.success(success);
    } catch (err) {
      toast.fromError(err, 'Not done');
    } finally {
      setBusy(null);
      setCancelling(null);
      reload({ silent: true }); // show the true current state either way
    }
  };

  const isNgo = user.role === 'ngo';
  const isDonor = user.role === 'donor';
  const title = isNgo ? 'My claims' : isDonor ? 'Incoming claims' : 'All claims';
  const subtitle = isNgo
    ? 'Food your organization has reserved. Assign a volunteer within 30 minutes of claiming.'
    : isDonor
      ? 'NGOs that have reserved your food. Give the handover code to the volunteer who collects it.'
      : 'Every claim in the network (read-only).';

  if (error) return <LoadError error={error} onRetry={() => reload()} />;
  if (!data) return <Loading label="Loading claims…" />;

  const open = data.filter((c) => OPEN.includes(c.status));
  const closed = data.filter((c) => !OPEN.includes(c.status));
  const shown = tab === 'open' ? open : closed;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Tabs
        label="Claims"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'open', label: 'In progress', count: open.length },
          { value: 'closed', label: 'History', count: closed.length },
        ]}
      >
        {shown.length === 0 ? (
          <EmptyState
            title={tab === 'open' ? 'Nothing in progress' : 'No history yet'}
            action={
              isNgo && tab === 'open' ? (
                <Link className="link" to="/feed">
                  Browse the live feed
                </Link>
              ) : null
            }
          >
            {tab === 'open' ? (isNgo ? 'Claim food from the live feed and it will appear here.' : 'New claims appear here automatically.') : 'Finished, cancelled and expired claims are listed here.'}
          </EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {shown.map((c) => (
              <ClaimCard key={c.id} claim={c} showCode={isDonor || user.role === 'admin'}>
                {isNgo && c.status === 'CLAIMED' && <Button onClick={() => setAssigning(c)}>Assign a volunteer</Button>}
                {isNgo && c.status === 'VOLUNTEER_ASSIGNED' && (
                  <Button variant="secondary" busy={busy === `un:${c.id}`} disabled={Boolean(busy)} onClick={() => run(`un:${c.id}`, () => api.post(`/claims/${c.id}/unassign`), 'Volunteer removed. Assign another one.')}>
                    Remove volunteer
                  </Button>
                )}
                {isNgo && c.status === 'PICKED_UP' && (
                  <Button busy={busy === `dl:${c.id}`} disabled={Boolean(busy)} onClick={() => run(`dl:${c.id}`, () => api.post(`/claims/${c.id}/deliver`), `${mealsText(c.meals)} received. Thank you!`)}>
                    Confirm we received it
                  </Button>
                )}
                {isNgo && (c.status === 'CLAIMED' || c.status === 'VOLUNTEER_ASSIGNED') && (
                  <Button variant="danger" disabled={Boolean(busy)} onClick={() => setCancelling(c)}>
                    Cancel claim
                  </Button>
                )}
              </ClaimCard>
            ))}
          </ul>
        )}
      </Tabs>

      {assigning && (
        <AssignDialog
          claim={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            reload({ silent: true });
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel this claim?"
        confirmLabel="Cancel claim"
        busy={Boolean(busy)}
        onClose={() => setCancelling(null)}
        onConfirm={() => run(`cx:${cancelling.id}`, () => api.post(`/claims/${cancelling.id}/cancel`), 'Claim cancelled. The meals are back in the feed.')}
      >
        {cancelling && `${mealsText(cancelling.meals)} from ${cancelling.donor.name} will go back to the live feed for other NGOs.`}
      </ConfirmDialog>
    </>
  );
}

function AssignDialog({ claim, onClose, onDone }) {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.get('/volunteers').then((d) => d.items), []);
  const [volunteerId, setVolunteerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !volunteerId) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await api.post(`/claims/${claim.id}/assign`, { volunteerId });
      toast.success(`${res.claim.volunteer.name} will collect ${mealsText(claim.meals)}.`, { title: 'Volunteer assigned' });
      onDone();
    } catch (err) {
      setFailure(err);
      setBusy(false);
      reload({ silent: true }); // the volunteer list may have changed
    }
  };

  return (
    <Modal open onClose={onClose} title="Assign a volunteer">
      <p className="mb-3 text-sm text-stone-700">
        {mealsText(claim.meals)} from <strong>{claim.donor.name}</strong>. Volunteers can also accept this pickup themselves from their job board.
      </p>
      {failure && (
        <Alert tone="error" className="mb-3">
          {failure.message}
        </Alert>
      )}
      {error ? (
        <LoadError error={error} onRetry={() => reload()} />
      ) : !data ? (
        <Loading />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Volunteer" required hint="A volunteer can carry at most 2 pickups at a time.">
            {(p) => (
              <select {...p} className="input" value={volunteerId} onChange={(e) => setVolunteerId(e.target.value)}>
                <option value="">Choose a volunteer…</option>
                {data.map((v) => (
                  <option key={v.id} value={v.id} disabled={!v.available}>
                    {v.name} · {v.activePickups} active, {v.deliveries} delivered{v.available ? '' : ' (busy)'}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Not now
            </Button>
            <Button type="submit" busy={busy} disabled={!volunteerId}>
              Assign
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

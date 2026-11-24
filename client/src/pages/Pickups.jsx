import { useState } from 'react';
import { ClaimCard } from '../components/ClaimCard.jsx';
import { Alert, Button, EmptyState, Field, LoadError, Loading, Modal, PageHeader, Tabs, useLoad } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { meals as mealsText } from '../lib/format.js';
import { useLive } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

/** Volunteer workspace: my pickups, the open job board, and my delivery history. */
export default function Pickups() {
  const { config } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('mine');
  const mine = useLoad(() => api.get('/claims').then((d) => d.items), []);
  const board = useLoad(() => api.get('/pickups/open').then((d) => d.items), []);
  const [busy, setBusy] = useState(null);
  const [collecting, setCollecting] = useState(null);

  const refresh = () => {
    mine.reload({ silent: true });
    board.reload({ silent: true });
  };
  useLive('claim.changed', refresh);
  useLive('resync', refresh);

  const run = async (key, fn, success) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      toast.success(success);
    } catch (err) {
      // For example another volunteer accepted it a moment earlier.
      toast.fromError(err, 'Not done');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  if (mine.error || board.error) return <LoadError error={mine.error || board.error} onRetry={() => (mine.reload(), board.reload())} />;
  if (!mine.data || !board.data) return <Loading label="Loading pickups…" />;

  const active = mine.data.filter((c) => c.status === 'VOLUNTEER_ASSIGNED' || c.status === 'PICKED_UP');
  const done = mine.data.filter((c) => c.status === 'DELIVERED');
  const limit = config?.limits?.MAX_ACTIVE_PICKUPS ?? 2;
  const full = active.length >= limit;

  return (
    <>
      <PageHeader title="Pickups" subtitle="Collect food from donors and deliver it to the NGO that claimed it." />
      <Tabs
        label="Pickups"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'mine', label: 'My pickups', count: active.length },
          { value: 'board', label: 'Available', count: board.data.length },
          { value: 'done', label: 'Done', count: done.length },
        ]}
      />

      {tab === 'mine' &&
        (active.length === 0 ? (
          <EmptyState
            title="You have no pickups right now"
            action={
              <Button variant="secondary" onClick={() => setTab('board')}>
                See available pickups
              </Button>
            }
          >
            Accept one from the board, or wait for an NGO to assign you.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {active.map((c) => (
              <ClaimCard key={c.id} claim={c}>
                {c.status === 'VOLUNTEER_ASSIGNED' && (
                  <>
                    <Button onClick={() => setCollecting(c)} disabled={Boolean(busy)}>
                      I have collected it
                    </Button>
                    <Button variant="secondary" busy={busy === `un:${c.id}`} disabled={Boolean(busy)} onClick={() => run(`un:${c.id}`, () => api.post(`/claims/${c.id}/unassign`), 'Handed back. Another volunteer can take it.')}>
                      I cannot do this
                    </Button>
                  </>
                )}
                {c.status === 'PICKED_UP' && (
                  <Button busy={busy === `dl:${c.id}`} disabled={Boolean(busy)} onClick={() => run(`dl:${c.id}`, () => api.post(`/claims/${c.id}/deliver`), `${mealsText(c.meals)} delivered. Thank you!`)}>
                    I have delivered it
                  </Button>
                )}
              </ClaimCard>
            ))}
          </ul>
        ))}

      {tab === 'board' && (
        <>
          {full && (
            <Alert tone="info" className="mb-4">
              You are carrying {limit} pickups, the most allowed at once. Deliver one before accepting another.
            </Alert>
          )}
          {board.data.length === 0 ? (
            <EmptyState title="Nothing needs a volunteer right now">New pickups appear here the moment an NGO claims food.</EmptyState>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {board.data.map((c) => (
                <ClaimCard key={c.id} claim={c}>
                  <Button busy={busy === `ac:${c.id}`} disabled={Boolean(busy) || full} onClick={() => run(`ac:${c.id}`, () => api.post(`/claims/${c.id}/accept`), 'Pickup accepted. It is in "My pickups".')}>
                    Accept this pickup
                  </Button>
                </ClaimCard>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === 'done' &&
        (done.length === 0 ? (
          <EmptyState title="No deliveries yet">Your completed deliveries will be listed here.</EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {done.map((c) => (
              <ClaimCard key={c.id} claim={c} />
            ))}
          </ul>
        ))}

      {collecting && (
        <CollectDialog
          claim={collecting}
          onClose={() => setCollecting(null)}
          onDone={() => {
            setCollecting(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

/** Collection is confirmed with the donor's 6-digit code, which proves the handover happened in person. */
function CollectDialog({ claim, onClose, onDone }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) return setError('The handover code is 6 digits.');
    setBusy(true);
    setError(null);
    try {
      await api.post(`/claims/${claim.id}/pickup`, { handoverCode: code });
      toast.success(`Now deliver ${mealsText(claim.meals)} to ${claim.ngo.name}.`, { title: 'Collection confirmed' });
      onDone();
    } catch (err) {
      setError(err.fieldErrors?.handoverCode || err.message);
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Confirm collection">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-stone-700">
          Ask the staff at <strong>{claim.donor.name}</strong> for the handover code shown on their screen.
        </p>
        <Field label="6-digit handover code" required error={error}>
          {(p) => (
            <input
              {...p}
              className="input tabular text-center font-mono text-2xl tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              data-autofocus
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={code.length !== 6}>
            Confirm collection
          </Button>
        </div>
      </form>
    </Modal>
  );
}

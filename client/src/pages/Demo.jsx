import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, ConfirmDialog, Field, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { duration } from '../lib/format.js';
import { simulateDrop, useClock, useConnection } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

/**
 * Demo console (admin, demo mode). Each card reproduces one judging scenario on
 * demand. The server runs the same service code the normal API uses, with
 * genuinely concurrent database transactions, and reports what happened.
 */
export default function Demo() {
  const { config } = useAuth();
  if (!config?.demoMode) return <Alert tone="warning">The demo console is switched off on this deployment (DEMO_MODE is not enabled).</Alert>;
  return (
    <>
      <PageHeader title="Demo console" subtitle="Reproduce the hard scenarios on demand. Every run goes through the real claim and edit code against the real database." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Race />
        <Idempotency />
        <Conflict />
        <Connection />
        <Clock />
        <Integrity />
      </div>
    </>
  );
}

function Card({ tag, title, children, proves }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div>
        <Badge tone="blue">{tag}</Badge>
        <h2 className="mt-1 text-lg font-bold">{title}</h2>
        <p className="text-sm text-stone-600">{proves}</p>
      </div>
      {children}
    </section>
  );
}

/** Runs one scenario; the button is locked while it is in flight. */
function useRun() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      setResult(await fn());
    } catch (err) {
      toast.fromError(err, 'Scenario failed to run');
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, run };
}

const Verdict = ({ passed, children }) => (
  <Alert tone={passed ? 'success' : 'error'} title={passed ? 'Passed' : 'FAILED'}>
    {children}
  </Alert>
);

const num = (setter) => (e) => setter(e.target.value === '' ? '' : Number(e.target.value));

function Race() {
  const { busy, result, run } = useRun();
  const [meals, setMeals] = useState(40);
  const [contenders, setContenders] = useState(6);
  const [requestEach, setRequestEach] = useState(15);
  const [keep, setKeep] = useState(false);
  const valid = [meals, contenders, requestEach].every((n) => Number.isInteger(n) && n >= 1) && contenders >= 2 && contenders <= 8 && meals <= 500 && requestEach <= 500;

  return (
    <Card tag="A05 · Concurrency" title="Race for the last meals" proves="Several NGOs request the final meals at the same instant. The listing must never be oversold.">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Meals left">{(p) => <input {...p} className="input" type="number" min="1" max="500" value={meals} onChange={num(setMeals)} />}</Field>
        <Field label="NGOs racing">{(p) => <input {...p} className="input" type="number" min="2" max="8" value={contenders} onChange={num(setContenders)} />}</Field>
        <Field label="Each asks for">{(p) => <input {...p} className="input" type="number" min="1" max="500" value={requestEach} onChange={num(setRequestEach)} />}</Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        Keep the test listing afterwards (watch it in the live feed in another window)
      </label>
      <Button busy={busy} disabled={!valid} onClick={() => run(() => api.post('/admin/demo/race', { meals, contenders, requestEach, keep }))}>
        Run the race
      </Button>
      {result && (
        <div className="space-y-3" aria-live="polite">
          <Verdict passed={result.passed}>
            {result.setup.contenders} NGOs asked for {result.setup.totalRequested} meals in total; only {result.setup.mealsAvailable} existed. Granted <strong>{result.totalGranted}</strong>, remaining{' '}
            <strong>{result.ledger.remainingMeals}</strong>, oversold: <strong>{result.ledger.oversold ? 'YES' : 'no'}</strong>. Took {result.elapsedMs} ms.
          </Verdict>
          <ResultTable
            caption="Outcome for each NGO"
            head={['NGO', 'Asked', 'Granted', 'Outcome']}
            rows={result.results.map((r) => [r.ngo, r.requested, r.granted, <Outcome key="o" value={r.outcome} detail={r.detail} />])}
          />
          {result.kept && (
            <p className="text-sm">
              <Link className="link" to={`/listings/${result.listingId}`}>
                Open the test listing
              </Link>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const OUTCOME_TONE = { GRANTED: 'green', PARTIAL: 'amber', SAVED: 'green', VERSION_CONFLICT: 'amber' };
function Outcome({ value, detail }) {
  return (
    <span>
      <Badge tone={OUTCOME_TONE[value] || 'gray'}>{value.replaceAll('_', ' ')}</Badge>
      {detail && <span className="mt-0.5 block text-xs text-stone-600">{detail}</span>}
    </span>
  );
}

function ResultTable({ caption, head, rows }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-stone-100 text-xs uppercase tracking-wide text-stone-600">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-t border-stone-100 align-top">
              {cells.map((c, j) => (
                <td key={j} className="tabular px-3 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Idempotency() {
  const { busy, result, run } = useRun();
  return (
    <Card tag="A05 · Idempotency" title="The same request, sent six times" proves="A flaky connection re-sends one claim five times at once and once more later, all with the same Idempotency-Key. It must be executed exactly once.">
      <Button busy={busy} onClick={() => run(() => api.post('/admin/demo/idempotency', { copies: 5 }))}>
        Send duplicate requests
      </Button>
      {result && (
        <div className="space-y-3" aria-live="polite">
          <Verdict passed={result.passed}>
            {result.requestsSent} requests sent, <strong>{result.claimsCreated}</strong> claim created. Meals left: {result.ledger.remainingMeals} of {result.ledger.totalMeals} (10 claimed once, not {result.requestsSent * 10}).
          </Verdict>
          <ResultTable
            caption="Response to each copy of the request"
            head={['Request', 'HTTP', 'Handling', 'Claim id']}
            rows={result.responses.map((r) => [`#${r.request}${r.late ? ' (late retry)' : ''}`, r.status, r.replayed ? 'Replayed stored response' : 'Executed', r.claimId?.slice(0, 8)])}
          />
        </div>
      )}
    </Card>
  );
}

function Conflict() {
  const { busy, result, run } = useRun();
  return (
    <Card tag="A01 · Conflict detection" title="Two people save the same listing" proves="Two staff members edit the same version at the same instant, with different values. Exactly one save may win; the other must be told, not silently overwritten.">
      <Button busy={busy} onClick={() => run(() => api.post('/admin/demo/conflict'))}>
        Run simultaneous edits
      </Button>
      {result && (
        <div className="space-y-3" aria-live="polite">
          <Verdict passed={result.passed}>
            Both edits were based on version {result.baseVersion}. The listing is now at version {result.final.version} with {result.final.totalMeals} meals: the winner’s value, intact.
          </Verdict>
          <ResultTable
            caption="Result for each editor"
            head={['Editor', 'Tried to set', 'Outcome']}
            rows={result.results.map((r) => [
              r.editor,
              `${r.wanted} meals`,
              <Outcome key="o" value={r.outcome} detail={r.outcome === 'SAVED' ? `Saved as version ${r.newVersion}` : `Rejected with HTTP 409. Server has version ${r.serverVersion} (${r.serverTotalMeals} meals), changed by ${r.changedBy}.`} />,
            ])}
          />
        </div>
      )}
      <p className="text-xs text-stone-600">
        To see the merge screen by hand: sign in as “Donor” in one window and “Donor (2nd staff)” in another, open the same listing, click Edit in both, change the same field, and save both.
      </p>
    </Card>
  );
}

function Connection() {
  const { status } = useConnection();
  return (
    <Card tag="A01 · Recovery" title="Drop the live connection" proves="This browser loses its WebSocket for 5 seconds. On reconnect every open page refetches a full snapshot, so nothing missed while offline stays stale.">
      <p className="text-sm">
        Connection: <Badge tone={status === 'online' ? 'green' : 'amber'}>{status}</Badge>
      </p>
      <Button onClick={() => simulateDrop(5000)} disabled={status !== 'online'}>
        Disconnect for 5 seconds
      </Button>
      <p className="text-xs text-stone-600">Try it with the live feed open in this window: change a listing from another window during the gap, and watch it catch up when the connection returns.</p>
    </Card>
  );
}

function Clock() {
  const { busy, result, run } = useRun();
  const { offsetSeconds } = useClock();
  const move = (body) => run(() => api.post('/admin/demo/clock', body));
  return (
    <Card tag="M04 · Time rules" title="Fast-forward the clock" proves="Moves application time forward so the time-based rules fire: claims without a volunteer are released after 30 minutes, and food past its safe-until time expires.">
      <p className="text-sm">
        Application clock: <strong>{offsetSeconds === 0 ? 'real time' : `${duration(Math.abs(offsetSeconds) * 1000)} ahead`}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} onClick={() => move({ minutes: 31 })}>
          +31 minutes
        </Button>
        <Button busy={busy} onClick={() => move({ minutes: 180 })}>
          +3 hours
        </Button>
        <Button variant="secondary" busy={busy} disabled={offsetSeconds === 0} onClick={() => move({ reset: true })}>
          Back to real time
        </Button>
      </div>
      {result && (
        <Alert tone="info" title="Rules applied">
          {result.sweep.claimsReleased} claims released, {result.sweep.claimsExpired} claims expired, {result.sweep.listingsExpired} listings expired.
          {result.sweep.errors > 0 && ` ${result.sweep.errors} items failed and will be retried.`}
        </Alert>
      )}
      <p className="text-xs text-stone-600">This affects everyone using this deployment. Expired items stay expired; use “Reset demo data” to start again.</p>
    </Card>
  );
}

function Integrity() {
  const toast = useToast();
  const { busy, result, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    setResetting(true);
    try {
      await api.post('/admin/demo/reset');
      toast.success('Demo data restored. Everyone’s screen is refreshing.', { title: 'Reset complete' });
    } catch (err) {
      toast.fromError(err, 'Reset failed');
    } finally {
      setResetting(false);
      setConfirm(false);
    }
  };

  return (
    <Card tag="Consistency" title="Ledger check and reset" proves="For every listing: remaining meals = total − meals held by active and delivered claims. One mismatch would mean meals were created or lost.">
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} onClick={() => run(() => api.get('/admin/integrity'))}>
          Check every listing
        </Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Reset demo data
        </Button>
      </div>
      {result && (
        <Verdict passed={result.ok}>
          {result.listings} listings checked: {result.mismatches} mismatches, {result.negative} negative balances.
        </Verdict>
      )}
      <ConfirmDialog open={confirm} title="Reset all demo data?" confirmLabel="Reset" onConfirm={reset} onClose={() => setConfirm(false)} busy={resetting}>
        Everything returns to the original sample data and the clock returns to real time. Accounts created by visitors are removed. Demo sign-ins stay signed in.
      </ConfirmDialog>
    </Card>
  );
}

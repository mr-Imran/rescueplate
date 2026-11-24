import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Field, LoadError, Loading, PageHeader, Pagination, Tabs, useLoad } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { fullTime } from '../lib/format.js';
import { useLive } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

const ORG_STATUS = { VERIFIED: 'green', PENDING: 'amber', SUSPENDED: 'red' };

export default function Admin() {
  const [tab, setTab] = useState('orgs');
  return (
    <>
      <PageHeader title="Administration" subtitle="Verify organizations, manage accounts and review the audit trail." />
      <Tabs
        label="Administration"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'orgs', label: 'Organizations' },
          { value: 'users', label: 'Users' },
          { value: 'audit', label: 'Audit log' },
        ]}
      >
        {tab === 'orgs' && <Organizations />}
        {tab === 'users' && <Users />}
        {tab === 'audit' && <Audit />}
      </Tabs>
    </>
  );
}

/** Runs an admin action once, reports the result, and always reloads the true state. */
function useAction(reload) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
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
      reload({ silent: true });
    }
  };
  return { busy, run };
}

function Organizations() {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useLoad(() => api.get(`/admin/organizations${qs({ status })}`).then((d) => d.items), [status]);
  const { busy, run } = useAction(reload);
  useLive('org.changed', () => reload({ silent: true }));
  useLive('resync', () => reload({ silent: true }));
  const set = (o, next, message) => run(`${o.id}:${next}`, () => api.post(`/admin/organizations/${o.id}/status`, { status: next }), message);

  return (
    <>
      <Field label="Status" className="mb-4 max-w-xs">
        {(p) => (
          <select {...p} className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Waiting for verification</option>
            <option value="VERIFIED">Verified</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        )}
      </Field>
      {error ? (
        <LoadError error={error} onRetry={() => reload()} />
      ) : !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState title="No organizations match" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.map((o) => (
            <li key={o.id} className="card flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 break-words font-bold">{o.name}</h2>
                <Badge tone={ORG_STATUS[o.status]}>{o.status === 'PENDING' ? 'Needs verification' : o.status === 'VERIFIED' ? 'Verified' : 'Suspended'}</Badge>
              </div>
              <p className="text-sm text-stone-700">
                {o.type === 'ngo' ? `NGO · capacity ${o.dailyCapacityMeals} meals per day` : 'Donor'} · {o.members} {o.members === 1 ? 'member' : 'members'}
              </p>
              <p className="text-sm text-stone-600">{o.address}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                {o.status !== 'VERIFIED' && (
                  <Button busy={busy === `${o.id}:VERIFIED`} disabled={Boolean(busy)} onClick={() => set(o, 'VERIFIED', `${o.name} is verified and can use the network now.`)}>
                    {o.status === 'SUSPENDED' ? 'Reinstate' : 'Verify'}
                  </Button>
                )}
                {o.status !== 'SUSPENDED' && (
                  <Button variant="danger" busy={busy === `${o.id}:SUSPENDED`} disabled={Boolean(busy)} onClick={() => set(o, 'SUSPENDED', `${o.name} is suspended.`)}>
                    Suspend
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Users() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const { data, error, reload } = useLoad(() => api.get(`/admin/users${qs({ q: dq })}`).then((d) => d.items), [dq]);
  const { busy, run } = useAction(reload);
  useLive('resync', () => reload({ silent: true }));

  return (
    <>
      <Field label="Search by name or email" className="mb-4 max-w-sm">
        {(p) => <input {...p} className="input" type="search" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} />}
      </Field>
      {error ? (
        <LoadError error={error} onRetry={() => reload()} />
      ) : !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState title="No users match" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">User accounts</caption>
            <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Name
                </th>
                <th scope="col" className="px-4 py-2">
                  Role
                </th>
                <th scope="col" className="px-4 py-2">
                  Organization
                </th>
                <th scope="col" className="px-4 py-2">
                  Status
                </th>
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="border-b border-stone-100 last:border-0">
                  <th scope="row" className="px-4 py-2 font-normal">
                    <span className="block font-medium">{u.name}</span>
                    <span className="block text-stone-500">{u.email}</span>
                  </th>
                  <td className="px-4 py-2 capitalize">{u.role}</td>
                  <td className="px-4 py-2">{u.orgName || '–'}</td>
                  <td className="px-4 py-2">
                    <Badge tone={u.status === 'ACTIVE' ? 'green' : 'red'}>{u.status === 'ACTIVE' ? 'Active' : 'Suspended'}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {u.id === me.id ? (
                      <span className="text-xs text-stone-500">This is you</span>
                    ) : u.status === 'ACTIVE' ? (
                      <Button
                        variant="danger"
                        className="min-h-8 px-3 py-1"
                        busy={busy === u.id}
                        disabled={Boolean(busy)}
                        onClick={() => run(u.id, () => api.post(`/admin/users/${u.id}/status`, { status: 'SUSPENDED' }), `${u.name} was suspended and signed out everywhere.`)}
                        aria-label={`Suspend ${u.name}`}
                      >
                        Suspend
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="min-h-8 px-3 py-1"
                        busy={busy === u.id}
                        disabled={Boolean(busy)}
                        onClick={() => run(u.id, () => api.post(`/admin/users/${u.id}/status`, { status: 'ACTIVE' }), `${u.name} can sign in again.`)}
                        aria-label={`Reactivate ${u.name}`}
                      >
                        Reactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Audit() {
  const [entityType, setEntityType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim());
  useEffect(() => setPage(1), [dq, entityType]);
  const { data, error, reload } = useLoad(() => api.get(`/admin/audit${qs({ entityType, q: dq, page, pageSize: 20 })}`), [entityType, dq, page]);
  useLive('resync', () => reload({ silent: true }));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Record type">
          {(p) => (
            <select {...p} className="input w-48" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              <option value="">All</option>
              <option value="listing">Listings</option>
              <option value="claim">Claims and pickups</option>
              <option value="organization">Organizations</option>
              <option value="user">Users</option>
              <option value="system">System</option>
            </select>
          )}
        </Field>
        <Field label="Search actor or action">
          {(p) => <input {...p} className="input w-64" type="search" maxLength={100} placeholder="e.g. Farhana, claim.created, System" value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <Button variant="secondary" onClick={() => reload()}>
          Refresh
        </Button>
      </div>
      {error ? (
        <LoadError error={error} onRetry={() => reload()} />
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <EmptyState title="No audit records match" />
      ) : (
        <>
          <p className="mb-2 text-sm text-stone-600">{data.total} records. Every change is written in the same database transaction as the change itself.</p>
          <ul className="space-y-2">
            {data.items.map((a) => (
              <li key={a.id} className="card p-3 text-sm">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-xs font-semibold text-brand-800">{a.action}</span>
                    <span className="font-medium">{a.actor}</span>
                    <span className="text-xs text-stone-500">{fullTime(a.at)}</span>
                  </summary>
                  <dl className="mt-2 grid gap-2 border-t border-stone-100 pt-2 text-xs sm:grid-cols-3">
                    {[
                      ['Before', a.before],
                      ['After', a.after],
                      ['Details', a.meta],
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="font-semibold text-stone-500">{label}</dt>
                        <dd>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-stone-800">{value ? JSON.stringify(value, null, 1) : '–'}</pre>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-1 text-xs text-stone-500">
                    {a.entityType}
                    {a.entityId ? ` ${a.entityId}` : ''}
                    {a.requestId ? ` · request ${a.requestId}` : ''}
                  </p>
                </details>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      )}
    </>
  );
}

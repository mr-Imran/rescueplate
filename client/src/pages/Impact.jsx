import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Field, LoadError, Loading, PageHeader, useLoad } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { FOOD_LABELS, number } from '../lib/format.js';
import { useLive } from '../lib/realtime.js';
import { useAuth } from '../state/auth.jsx';

// Chart colours: two categorical series, checked for colour-blind separation and
// contrast against the white card. Text never uses these; it stays in normal ink.
const SERIES = {
  rescued: { label: 'Rescued (delivered)', color: '#2a78d6' },
  expired: { label: 'Expired (wasted)', color: '#eb6834' },
};

const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};
const dayLabel = (iso, opts = { month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

export default function Impact() {
  const { user } = useAuth();
  const [days, setDays] = useState(14);
  const [scope, setScope] = useState('all');
  const query = qs({ days, scope, tz: browserTimezone() });
  const { data, error, loading, reload } = useLoad(() => api.get(`/stats/impact${query}`), [query]);

  // Figures follow the live system: refresh shortly after any claim or listing changes.
  const timer = useRef(null);
  const refreshSoon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => reload({ silent: true }), 1200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLive('claim.changed', refreshSoon);
  useLive('listing.upsert', refreshSoon);
  useLive('resync', refreshSoon);

  const canScope = user.role !== 'admin';
  const mineLabel = user.org ? user.org.name : 'My deliveries';

  return (
    <>
      <PageHeader title="Impact" subtitle="What the network has rescued, calculated live from every delivery." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="Period">
          {(p) => (
            <select {...p} className="input w-44" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          )}
        </Field>
        {canScope && (
          <Field label="Show">
            {(p) => (
              <select {...p} className="input w-56" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">Whole network</option>
                <option value="mine">{mineLabel}</option>
              </select>
            )}
          </Field>
        )}
      </div>

      {error ? (
        <LoadError error={error} onRetry={() => reload()} />
      ) : !data ? (
        <Loading label="Calculating impact…" />
      ) : (
        <div className="space-y-4" aria-busy={loading}>
          <Tiles t={data.totals} assumptions={data.assumptions} personal={data.scope === 'mine' && user.role === 'volunteer'} />
          <section className="card p-5" aria-labelledby="daily-title">
            <h2 id="daily-title" className="font-bold">
              Meals per day
            </h2>
            <p className="text-sm text-stone-600">Meals delivered to NGOs compared with meals that passed their safe-until time unclaimed.</p>
            <DailyChart rows={data.daily} />
          </section>
          <div className="grid gap-4 lg:grid-cols-3">
            <Ranked title="Top donors" unit="meals rescued" rows={data.topDonors.map((r) => ({ name: r.name, value: r.meals }))} />
            <Ranked title="Top NGOs" unit="meals received" rows={data.topNgos.map((r) => ({ name: r.name, value: r.meals }))} />
            <Ranked title="By food type" unit="meals rescued" rows={data.byFoodType.map((r) => ({ name: FOOD_LABELS[r.foodType] || r.foodType, value: r.rescued }))} />
          </div>
          <p className="text-xs text-stone-500">
            Weight and emissions are estimates: {data.assumptions.kgPerMeal} kg of food per meal and {data.assumptions.co2ePerKgFood} kg CO₂e avoided per kg of food not wasted. Days are shown in the {data.timezone} timezone.
          </p>
        </div>
      )}
    </>
  );
}

function Tiles({ t, assumptions, personal }) {
  const minutes = t.medianMinutesToDeliver;
  const tiles = [
    { label: 'Meals rescued', value: number(t.mealsRescued), note: `${number(t.deliveries)} ${t.deliveries === 1 ? 'delivery' : 'deliveries'}`, hero: true },
    { label: 'Food kept from waste', value: `${number(t.kgDiverted)} kg`, note: `about ${assumptions.kgPerMeal} kg per meal` },
    { label: 'Emissions avoided', value: `${number(t.co2eAvoidedKg)} kg`, note: 'CO₂ equivalent, estimated' },
    { label: 'Rescue rate', value: t.rescueRate === null ? '–' : `${t.rescueRate}%`, note: personal ? 'not applicable to one volunteer' : `${number(t.mealsExpired)} meals expired` },
    { label: 'Claim to delivery', value: minutes === null ? '–' : minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`, note: 'median time' },
    { label: 'On the way now', value: number(t.mealsInProgress), note: 'meals claimed, not yet delivered' },
    { label: 'Available now', value: number(t.mealsAvailable), note: 'meals waiting to be claimed' },
    { label: 'Listings posted', value: number(t.listingsPosted), note: 'in this period' },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((x) => (
        <div key={x.label} className={`card p-4 ${x.hero ? 'col-span-2 lg:col-span-1 lg:row-span-1' : ''}`}>
          <dt className="text-sm text-stone-600">{x.label}</dt>
          <dd className={`tabular font-bold tracking-tight text-stone-900 ${x.hero ? 'text-4xl' : 'text-2xl'}`}>{x.value}</dd>
          <dd className="text-xs text-stone-500">{x.note}</dd>
        </div>
      ))}
    </dl>
  );
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Round the axis top up to a clean number (10, 20, 50, 100, 200, ...). */
function niceMax(value) {
  if (value <= 10) return 10;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.2, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (value <= m * pow) return m * pow;
  return 10 * pow;
}

/** Column with a rounded top (the data end) and a square base on the baseline. */
function topRounded(x, y, w, h, r) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function DailyChart({ rows }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const H = 240;
  const pad = { top: 12, right: 8, bottom: 26, left: 38 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.rescued + r.expired)));
  const band = rows.length ? innerW / rows.length : 0;
  const barW = Math.max(3, Math.min(24, band * 0.62));
  const y = (v) => pad.top + innerH - (v / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(innerW / 58))));
  const GAP = 2;
  const total = rows.reduce((s, r) => s + r.rescued + r.expired, 0);
  const a = active === null ? null : rows[active];

  return (
    <div className="mt-3">
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-700" aria-label="Legend">
        {Object.values(SERIES).map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={`Stacked column chart of meals rescued and meals expired per day over ${rows.length} days. The same figures are in the table below.`}>
            {[0, max / 2, max].map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#e7e5e4" strokeWidth="1" />
                <text x={pad.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#78716c" className="tabular">
                  {number(tick)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = pad.left + band * i + band / 2;
              const x = cx - barW / 2;
              const hR = (r.rescued / max) * innerH;
              const hE = (r.expired / max) * innerH;
              const base = pad.top + innerH;
              const gap = hR > 0 && hE > 0 ? GAP : 0; // surface-coloured gap between the two segments
              return (
                <g key={r.day} opacity={active === null || active === i ? 1 : 0.55}>
                  {hR > 0 && (hE > 0 ? <rect x={x} y={base - hR} width={barW} height={hR} fill={SERIES.rescued.color} /> : <path d={topRounded(x, base - hR, barW, hR, 4)} fill={SERIES.rescued.color} />)}
                  {hE > 0 && <path d={topRounded(x, base - hR - gap - hE, barW, hE, 4)} fill={SERIES.expired.color} />}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#78716c">
                      {dayLabel(r.day)}
                    </text>
                  )}
                  {/* Full-height hit area: easier to hover than the bar, and reachable by keyboard. */}
                  <rect
                    x={pad.left + band * i}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={`${dayLabel(r.day, { weekday: 'long', month: 'long', day: 'numeric' })}: ${r.rescued} meals rescued, ${r.expired} expired`}
                    onPointerEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    style={{ outlineOffset: -2 }}
                  />
                </g>
              );
            })}
            <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#a8a29e" strokeWidth="1" />
          </svg>
        )}
        {a && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-44 rounded-lg border border-stone-200 bg-white p-2 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(0, pad.left + band * active + band / 2 - 88), Math.max(0, width - 176)) }}
          >
            <p className="mb-1 font-semibold text-stone-900">{dayLabel(a.day, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
            {['rescued', 'expired'].map((k) => (
              <p key={k} className="flex items-center justify-between gap-2 text-stone-600">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded" style={{ background: SERIES[k].color }} aria-hidden="true" />
                  {k === 'rescued' ? 'Rescued' : 'Expired'}
                </span>
                <span className="tabular text-sm font-bold text-stone-900">{number(a[k])}</span>
              </p>
            ))}
          </div>
        )}
        {total === 0 && width > 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-500">No deliveries or expiries in this period.</p>}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium text-brand-800">View as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="py-1 pr-4">
                  Day
                </th>
                <th scope="col" className="py-1 pr-4 text-right">
                  Rescued
                </th>
                <th scope="col" className="py-1 text-right">
                  Expired
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day} className="border-t border-stone-100">
                  <th scope="row" className="py-1 pr-4 font-normal">
                    {dayLabel(r.day, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </th>
                  <td className="tabular py-1 pr-4 text-right">{number(r.rescued)}</td>
                  <td className="tabular py-1 text-right">{number(r.expired)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Ranked horizontal bars: one hue, value printed at the end of each bar. */
function Ranked({ title, unit, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="card p-5">
      <h2 className="font-bold">{title}</h2>
      <p className="mb-3 text-xs text-stone-500">{unit}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">Nothing in this period yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.name} title={`${r.name}: ${number(r.value)} ${unit}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-stone-800">{r.name}</span>
                <span className="tabular font-bold text-stone-900">{number(r.value)}</span>
              </div>
              <div className="mt-1 h-2.5">
                <div className="h-full rounded-r" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: SERIES.rescued.color }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

import { Link } from 'react-router-dom';
import { CLAIM_STATUS, clockTime, FOOD_LABELS, meals as mealsText } from '../lib/format.js';
import { Badge, Countdown, useNow } from './ui.jsx';

const OPEN = ['CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP'];

/** One claim with its route (donor -> NGO), deadline and status. Actions are passed in as children. */
export function ClaimCard({ claim, children, showCode = false }) {
  const now = useNow(1000);
  const status = CLAIM_STATUS[claim.status];
  const open = OPEN.includes(claim.status);
  const beforePickup = claim.status === 'CLAIMED' || claim.status === 'VOLUNTEER_ASSIGNED';
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words font-bold leading-snug">
          <Link to={`/listings/${claim.listing.id}`} className="hover:underline">
            {claim.listing.title}
          </Link>
        </h3>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="-mt-2 text-sm text-stone-700">
        <span className="tabular font-bold text-stone-900">{mealsText(claim.meals)}</span> · {FOOD_LABELS[claim.listing.foodType]} · {claim.listing.isVeg ? 'vegetarian' : 'contains meat, fish or egg'}
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">Collect from</dt>
          <dd className="font-medium">{claim.donor.name}</dd>
          <dd className="text-stone-600">{claim.donor.address}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">Deliver to</dt>
          <dd className="font-medium">{claim.ngo.name}</dd>
          <dd className="text-stone-600">{claim.ngo.address}</dd>
        </div>
      </dl>
      {open && (
        <p className="text-sm text-stone-700">
          {beforePickup ? (
            <>
              Must be collected within <Countdown until={claim.listing.safeUntil} expiredLabel="too late: the food has expired" /> <span className="text-stone-500">(by {clockTime(claim.listing.safeUntil, now)})</span>
            </>
          ) : (
            <>Collected {claim.pickedUpAt ? clockTime(claim.pickedUpAt, now) : ''} and on its way.</>
          )}
        </p>
      )}
      {claim.status === 'CLAIMED' && claim.releaseAt && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          No volunteer yet. Released back to the feed in <Countdown until={claim.releaseAt} expiredLabel="a moment" />.
        </p>
      )}
      {claim.volunteer && (
        <p className="text-sm text-stone-700">
          Volunteer: <span className="font-medium">{claim.volunteer.name}</span>
        </p>
      )}
      {claim.status === 'DELIVERED' && claim.deliveredAt && <p className="text-sm text-stone-700">Delivered {clockTime(claim.deliveredAt, now)}.</p>}
      {showCode && claim.handoverCode && (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
          <span className="block text-xs font-semibold uppercase tracking-wide">Handover code</span>
          <span className="tabular font-mono text-2xl font-bold tracking-widest">{claim.handoverCode}</span>
          <span className="block text-xs">Read it to the volunteer at pickup. They need it to confirm collection.</span>
        </p>
      )}
      {children && <div className="mt-auto flex flex-wrap gap-2 pt-1">{children}</div>}
    </li>
  );
}

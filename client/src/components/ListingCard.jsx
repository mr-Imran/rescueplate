import { Link } from 'react-router-dom';
import { clockTime, FOOD_LABELS, LISTING_STATUS } from '../lib/format.js';
import { Badge, Button, Countdown, useNow } from './ui.jsx';

/** True while meals can still be claimed, judged by the server clock. */
export function isClaimable(listing, now) {
  return ['POSTED', 'PARTIALLY_CLAIMED'].includes(listing.status) && listing.remainingMeals > 0 && new Date(listing.safeUntil).getTime() > now;
}

/** The status to display: a listing past its deadline reads "Expired" even before the server sweeper runs. */
export function displayStatus(listing, now) {
  const pastDeadline = new Date(listing.safeUntil).getTime() <= now;
  if (pastDeadline && ['POSTED', 'PARTIALLY_CLAIMED'].includes(listing.status)) return LISTING_STATUS.EXPIRED;
  return LISTING_STATUS[listing.status] || { label: listing.status, tone: 'gray' };
}

export function DietBadge({ isVeg }) {
  return <Badge tone={isVeg ? 'green' : 'amber'}>{isVeg ? 'Vegetarian' : 'Meat, fish or egg'}</Badge>;
}

export function MealsBar({ listing }) {
  const pct = Math.round((listing.remainingMeals / listing.totalMeals) * 100);
  return (
    <div>
      <p className="text-sm text-stone-700">
        <span className="tabular text-xl font-bold text-stone-900">{listing.remainingMeals}</span> of <span className="tabular">{listing.totalMeals}</span> meals left
      </p>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-200" role="img" aria-label={`${pct}% of meals still available`}>
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ListingCard({ listing, flash, canClaim, onClaim, manage }) {
  const now = useNow(1000);
  const status = displayStatus(listing, now);
  const claimable = isClaimable(listing, now);
  return (
    <li className={`card flex flex-col gap-3 p-4 ${flash ? 'live-flash' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-base font-bold leading-snug text-stone-900">
          <Link to={`/listings/${listing.id}`} className="hover:underline">
            {listing.title}
          </Link>
        </h2>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="-mt-2 text-sm text-stone-600">
        {listing.donor.name}
        {!manage && listing.distanceKm != null && <span className="tabular"> · {listing.distanceKm} km away</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <DietBadge isVeg={listing.isVeg} />
        <Badge>{FOOD_LABELS[listing.foodType] || listing.foodType}</Badge>
      </div>
      <MealsBar listing={listing} />
      <p className="text-sm text-stone-700">
        {claimable ? (
          <>
            Safe for <Countdown until={listing.safeUntil} /> <span className="text-stone-500">(until {clockTime(listing.safeUntil, now)})</span>
          </>
        ) : (
          <span className="text-stone-500">Safe until {clockTime(listing.safeUntil, now)}</span>
        )}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {canClaim && (
          <Button onClick={() => onClaim(listing)} disabled={!claimable} className="flex-1">
            {claimable ? 'Claim meals' : 'Not available'}
          </Button>
        )}
        <Link
          to={`/listings/${listing.id}`}
          className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-stone-800 ring-1 ring-inset ring-stone-300 hover:bg-stone-100"
          aria-label={`${manage ? 'Manage' : 'Details for'} ${listing.title}`}
        >
          {manage ? 'Manage' : 'Details'}
        </Link>
      </div>
    </li>
  );
}

export const FOOD_LABELS = {
  cooked_meal: 'Cooked meal',
  dairy: 'Dairy',
  bakery: 'Bakery',
  produce: 'Fresh produce',
  beverages: 'Beverages',
  packaged: 'Packaged food',
};

export const LISTING_STATUS = {
  POSTED: { label: 'Available', tone: 'green' },
  PARTIALLY_CLAIMED: { label: 'Partly claimed', tone: 'green' },
  FULLY_CLAIMED: { label: 'Fully claimed', tone: 'blue' },
  COMPLETED: { label: 'Delivered', tone: 'gray' },
  EXPIRED: { label: 'Expired', tone: 'red' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
};

export const CLAIM_STATUS = {
  CLAIMED: { label: 'Needs a volunteer', tone: 'amber' },
  VOLUNTEER_ASSIGNED: { label: 'Volunteer assigned', tone: 'blue' },
  PICKED_UP: { label: 'On the way', tone: 'blue' },
  DELIVERED: { label: 'Delivered', tone: 'green' },
  RELEASED: { label: 'Released (no volunteer)', tone: 'gray' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
  EXPIRED: { label: 'Expired before pickup', tone: 'red' },
};

export const FIELD_LABELS = {
  title: 'Title',
  description: 'Description',
  foodType: 'Food type',
  isVeg: 'Vegetarian',
  totalMeals: 'Total meals',
  preparedAt: 'Prepared at',
  safeUntil: 'Safe until',
  address: 'Address',
  lat: 'Latitude',
  lng: 'Longitude',
  dailyCapacityMeals: 'Daily capacity',
};

const AUDIT_LABELS = {
  'listing.created': 'posted this listing',
  'listing.updated': 'edited this listing',
  'listing.cancelled': 'cancelled this listing',
  'listing.expired': 'marked it expired (safe-until time passed)',
  'claim.created': 'claimed meals',
  'claim.cancelled': 'cancelled a claim (meals returned)',
  'claim.released': 'released a claim with no volunteer (meals returned)',
  'claim.expired': 'expired a claim that was not collected in time',
  'claim.delivered': 'confirmed a delivery',
};
export const auditLabel = (action) => AUDIT_LABELS[action] || action;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const meals = (n) => plural(n, 'meal');

/** "2 h 05 min", "14 min", "45 s" */
export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} days`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export function clockTime(value, now = Date.now()) {
  const d = new Date(value);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? timeFmt.format(d) : dateTimeFmt.format(d);
}
export const fullTime = (value) => fullFmt.format(new Date(value));

export function ago(value, now) {
  const ms = now - new Date(value).getTime();
  if (ms < 45_000) return 'just now';
  return `${duration(ms)} ago`;
}

/** Date -> value for <input type="datetime-local"> in the device's timezone. */
export function toLocalInput(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** <input type="datetime-local"> value -> ISO string (or null if empty or invalid). */
export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatValue(field, value) {
  if (field === 'isVeg') return value ? 'Vegetarian' : 'Contains meat, fish or egg';
  if (field === 'foodType') return FOOD_LABELS[value] || value;
  if (field === 'preparedAt' || field === 'safeUntil') return dateTimeFmt.format(new Date(value));
  if (field === 'description') return value || '(empty)';
  if (field === 'dailyCapacityMeals') return `${value} meals per day`;
  return String(value);
}

export const number = (n) => new Intl.NumberFormat().format(n);

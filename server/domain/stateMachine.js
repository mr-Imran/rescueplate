// Explicit state machines. Every status change in the system goes through
// assertTransition(), so an illegal jump (for example DELIVERED -> CLAIMED)
// throws instead of silently corrupting data.

export const LISTING_TRANSITIONS = {
  POSTED: ['PARTIALLY_CLAIMED', 'FULLY_CLAIMED', 'EXPIRED', 'CANCELLED'],
  PARTIALLY_CLAIMED: ['POSTED', 'FULLY_CLAIMED', 'COMPLETED', 'EXPIRED', 'CANCELLED'],
  FULLY_CLAIMED: ['POSTED', 'PARTIALLY_CLAIMED', 'COMPLETED', 'EXPIRED'],
  COMPLETED: [], // terminal: every meal was delivered
  EXPIRED: [], //   terminal: food-safety deadline passed with meals unrescued
  CANCELLED: [], // terminal: withdrawn by the donor
};

export const CLAIM_TRANSITIONS = {
  CLAIMED: ['VOLUNTEER_ASSIGNED', 'RELEASED', 'CANCELLED', 'EXPIRED'],
  VOLUNTEER_ASSIGNED: ['CLAIMED', 'PICKED_UP', 'CANCELLED', 'EXPIRED'],
  PICKED_UP: ['DELIVERED'],
  DELIVERED: [], // terminal
  RELEASED: [], //  terminal: no volunteer in time, meals returned to the listing
  CANCELLED: [], // terminal: withdrawn by the NGO
  EXPIRED: [], //   terminal: not collected before the food-safety deadline
};

export const LISTING_TERMINAL = ['COMPLETED', 'EXPIRED', 'CANCELLED'];
/** Claims that still hold meals but are not finished. */
export const CLAIM_OPEN = ['CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP'];
/** Claims whose meals count against the listing (open + delivered). */
export const CLAIM_HOLDING = ['CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'DELIVERED'];

const MACHINES = { listing: LISTING_TRANSITIONS, claim: CLAIM_TRANSITIONS };

export function canTransition(kind, from, to) {
  const machine = MACHINES[kind];
  if (!machine || !(from in machine) || !(to in machine)) return false;
  return from === to || machine[from].includes(to);
}

export function assertTransition(kind, from, to) {
  if (!canTransition(kind, from, to)) {
    throw new Error(`Illegal ${kind} transition: ${from} -> ${to}`);
  }
  return to;
}

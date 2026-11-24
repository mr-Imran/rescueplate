// Three-way merge for listing edits (used when the server reports a version conflict).
//
//   base   = the listing as it was when the user opened the form
//   mine   = what the user typed
//   theirs = the latest version on the server
//
// A field only one side changed merges automatically. A field both sides
// changed to different values is a true conflict the user must resolve.

export const EDITABLE_FIELDS = ['title', 'description', 'foodType', 'isVeg', 'totalMeals', 'preparedAt', 'safeUntil'];
const DATE_FIELDS = new Set(['preparedAt', 'safeUntil']);

export function sameField(field, a, b) {
  if (DATE_FIELDS.has(field)) {
    // Forms work in whole minutes; ignore seconds so an untouched date is not seen as "changed".
    return Math.floor(new Date(a).getTime() / 60000) === Math.floor(new Date(b).getTime() / 60000);
  }
  return a === b;
}

/** The fields the user actually changed, as a PATCH body (without expectedVersion). */
export function changedFields(base, mine) {
  const patch = {};
  for (const f of EDITABLE_FIELDS) if (!sameField(f, base[f], mine[f])) patch[f] = mine[f];
  return patch;
}

export function threeWayMerge(base, mine, theirs) {
  const merged = {};
  const conflicts = [];
  const takenFromTheirs = [];
  const keptMine = [];
  for (const f of EDITABLE_FIELDS) {
    const iChanged = !sameField(f, base[f], mine[f]);
    const theyChanged = !sameField(f, base[f], theirs[f]);
    if (iChanged && theyChanged && !sameField(f, mine[f], theirs[f])) {
      conflicts.push({ field: f, base: base[f], mine: mine[f], theirs: theirs[f] });
      merged[f] = mine[f]; // provisional; the user chooses
    } else if (iChanged) {
      merged[f] = mine[f];
      keptMine.push(f);
    } else {
      merged[f] = theirs[f];
      if (theyChanged) takenFromTheirs.push(f);
    }
  }
  return { merged, conflicts, takenFromTheirs, keptMine };
}

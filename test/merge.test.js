// The browser-side three-way merge used when the server reports a version conflict (A01).
import { describe, expect, it } from 'vitest';
import { changedFields, threeWayMerge } from '../client/src/lib/merge.js';
import { applyListing } from '../client/src/lib/realtime.js';

const base = { title: 'Khichuri', description: '', foodType: 'cooked_meal', isVeg: true, totalMeals: 50, preparedAt: '2026-06-01T10:00:00.000Z', safeUntil: '2026-06-01T14:00:00.000Z' };

describe('three-way merge', () => {
  it('merges automatically when the two people changed different fields', () => {
    const r = threeWayMerge(base, { ...base, title: 'Shobji khichuri' }, { ...base, totalMeals: 60, version: 2 });
    expect(r.conflicts).toEqual([]);
    expect(r.merged).toMatchObject({ title: 'Shobji khichuri', totalMeals: 60 });
    expect(r.keptMine).toEqual(['title']);
    expect(r.takenFromTheirs).toEqual(['totalMeals']);
  });

  it('reports a conflict only for a field both changed to different values', () => {
    const r = threeWayMerge(base, { ...base, totalMeals: 45, title: 'Mine' }, { ...base, totalMeals: 60, description: 'Theirs' });
    expect(r.conflicts).toEqual([{ field: 'totalMeals', base: 50, mine: 45, theirs: 60 }]);
    expect(r.keptMine).toEqual(['title']);
    expect(r.takenFromTheirs).toEqual(['description']);
  });

  it('is not a conflict when both made the same change', () => {
    const r = threeWayMerge(base, { ...base, totalMeals: 60 }, { ...base, totalMeals: 60 });
    expect(r.conflicts).toEqual([]);
    expect(r.merged.totalMeals).toBe(60);
  });

  it('takes theirs when I changed nothing (for example a claim reduced the count)', () => {
    const r = threeWayMerge(base, base, { ...base, safeUntil: '2026-06-01T13:00:00.000Z' });
    expect(r.conflicts).toEqual([]);
    expect(r.merged.safeUntil).toBe('2026-06-01T13:00:00.000Z');
  });

  it('compares dates to the minute, so an untouched date is never a false conflict', () => {
    const mine = { ...base, safeUntil: '2026-06-01T14:00:00.000Z' };
    const theirs = { ...base, safeUntil: '2026-06-01T14:00:30.000Z' };
    expect(threeWayMerge(base, mine, theirs).conflicts).toEqual([]);
    expect(changedFields(base, { ...base, preparedAt: '2026-06-01T10:00:45.000Z' })).toEqual({});
  });

  it('sends only the fields the user changed', () => {
    expect(changedFields(base, { ...base, title: 'New', isVeg: false })).toEqual({ title: 'New', isVeg: false });
    expect(changedFields(base, { ...base })).toEqual({});
  });
});

describe('three-way merge of organization details', () => {
  const FIELDS = ['address', 'lat', 'lng', 'dailyCapacityMeals'];
  const org = { address: 'House 55, Lalmatia, Dhaka', lat: 23.754, lng: 90.369, dailyCapacityMeals: 150, version: 4 };

  it('merges automatically when two colleagues changed different fields', () => {
    const mine = { ...org, dailyCapacityMeals: 200 };
    const theirs = { ...org, address: 'House 56, Lalmatia, Dhaka', version: 5 };
    const r = threeWayMerge(org, mine, theirs, FIELDS);
    expect(r.conflicts).toEqual([]);
    expect(r.merged).toEqual({ address: 'House 56, Lalmatia, Dhaka', lat: 23.754, lng: 90.369, dailyCapacityMeals: 200 });
    expect(changedFields(theirs, r.merged, FIELDS)).toEqual({ dailyCapacityMeals: 200 }); // only my change is sent
  });

  it('asks only about the field both changed', () => {
    const mine = { ...org, dailyCapacityMeals: 200, lat: 23.76 };
    const theirs = { ...org, dailyCapacityMeals: 120, version: 5 };
    const r = threeWayMerge(org, mine, theirs, FIELDS);
    expect(r.conflicts).toEqual([{ field: 'dailyCapacityMeals', base: 150, mine: 200, theirs: 120 }]);
    expect(r.keptMine).toEqual(['lat']);
  });

  it('ignores fields outside the list (a donor has no capacity)', () => {
    const r = threeWayMerge(org, { ...org, dailyCapacityMeals: 1 }, { ...org, dailyCapacityMeals: 2 }, ['address', 'lat', 'lng']);
    expect(r.conflicts).toEqual([]);
    expect(r.merged).not.toHaveProperty('dailyCapacityMeals');
  });
});

describe('applying live events', () => {
  const items = [
    { id: 'a', version: 3, remainingMeals: 20, distanceKm: 1.2 },
    { id: 'b', version: 1, remainingMeals: 5 },
  ];
  it('accepts a newer version and keeps locally computed fields', () => {
    const next = applyListing(items, { id: 'a', version: 4, remainingMeals: 10 });
    expect(next[0]).toEqual({ id: 'a', version: 4, remainingMeals: 10, distanceKm: 1.2 });
  });
  it('ignores stale and duplicate events, so a late event cannot roll the screen back', () => {
    expect(applyListing(items, { id: 'a', version: 2, remainingMeals: 40 })).toBe(items);
    expect(applyListing(items, { id: 'a', version: 3, remainingMeals: 99 })).toBe(items);
  });
  it('ignores events for listings that are not on screen', () => {
    expect(applyListing(items, { id: 'zzz', version: 9 })).toBe(items);
  });
});

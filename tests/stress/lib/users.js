// Loads the seeded stress users once and shares them across VUs.
// Each VU picks a stable user based on its __VU id so workloads spread
// across distinct user records (which avoids per-user lock contention
// dominating the timings, unless the scenario explicitly wants that).

import { SharedArray } from 'k6/data';

export const USERS = new SharedArray('stress-users', () => {
  const raw = open('../fixtures/users.json');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      'tests/stress/fixtures/users.json is missing or empty. ' +
        'Run: node tests/stress/seed-stress-users.mjs',
    );
  }
  return parsed;
});

// Stable assignment: VU 1 -> users[0], VU 2 -> users[1], wrapping.
export function userForVU(vuId) {
  return USERS[(vuId - 1) % USERS.length];
}

// Random user — for scenarios that simulate independent traffic.
export function randomUser() {
  return USERS[Math.floor(Math.random() * USERS.length)];
}

// Single shared user — for explicitly stress-testing per-user lock contention.
export function sharedHotUser() {
  return USERS[0];
}

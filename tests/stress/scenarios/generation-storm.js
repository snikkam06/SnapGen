// Generation-storm scenario — hammers POST /generations/image, which is
// the riskiest write path in the API:
//   - Acquires a per-user advisory lock (pg_advisory_xact_lock)
//   - Runs inside a SERIALIZABLE transaction with retries
//   - Reads + writes 3-4 tables, enqueues a BullMQ job
//   - Subject to a 20-req/60s @Throttle override
//
// Two modes:
//   STRESS_MODE=spread  (default) — every VU posts as a DIFFERENT user.
//     Tests overall API throughput / queue depth / pool exhaustion.
//   STRESS_MODE=hot                — every VU posts as the SAME user.
//     Tests advisory-lock contention + serializable-tx retry storms.
//
// Run:
//   k6 run tests/stress/scenarios/generation-storm.js
//   k6 run -e VUS=100 -e DURATION=2m tests/stress/scenarios/generation-storm.js
//   k6 run -e STRESS_MODE=hot -e VUS=50 tests/stress/scenarios/generation-storm.js
//
// Note: requires IMAGE_PROVIDER=mock (or real keys) on the API. With
// a real provider you'll quickly exhaust the FAL/Replicate semaphore.

import http from 'k6/http';
import { sleep } from 'k6';
import { url } from '../lib/config.js';
import { userForVU, sharedHotUser } from '../lib/users.js';
import { stressHeaders } from '../lib/auth.js';
import { classify } from '../lib/checks.js';

const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || '1m';
const MODE = __ENV.STRESS_MODE || 'spread';

const PROMPTS = [
  'a serene mountain lake at sunrise, photorealistic',
  'an astronaut riding a horse on Mars, digital art',
  'a cozy library full of magical books, fantasy concept art',
  'a futuristic city skyline at dusk, cyberpunk neon',
  'a hummingbird mid-flight over wildflowers, macro shot',
  'an old wooden ship sailing through a storm, oil painting',
  'a quiet Japanese garden in autumn, watercolor',
  'a steampunk workshop full of brass gears, intricate detail',
];

export const options = {
  scenarios: {
    generation_storm: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:POST /generations/image}': ['p(95)<2000'],
    success_rate: ['rate>0.80'],
    server_errors_total: ['count<20'],
  },
};

export default function () {
  const user = MODE === 'hot' ? sharedHotUser() : userForVU(__VU);
  const headers = stressHeaders(user);

  const body = JSON.stringify({
    prompt: PROMPTS[Math.floor(Math.random() * PROMPTS.length)],
    mode: 'base',
    settings: { numImages: 1 },
  });

  classify(
    http.post(url('/generations/image'), body, {
      headers,
      tags: { endpoint: 'POST /generations/image' },
    }),
    'POST /generations/image',
  );

  // A real user wouldn't submit back-to-back — but we want pressure.
  sleep(Math.random() * 0.5 + 0.1);
}

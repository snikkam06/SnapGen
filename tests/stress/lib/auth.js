import { BYPASS_TOKEN } from './config.js';

export function stressHeaders(user, extra = {}) {
  return {
    'x-stress-test-token': BYPASS_TOKEN,
    'x-stress-test-user-id': user.clerkUserId,
    'x-stress-test-user-email': user.email,
    'content-type': 'application/json',
    ...extra,
  };
}

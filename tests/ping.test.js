import { expect, test } from 'vitest';
import ping from '../netlify/functions/ping.js';

test('ping responde ok', async () => {
  const res = await ping(new Request('http://x/api/ping'));
  const body = await res.json();
  expect(body.ok).toBe(true);
});

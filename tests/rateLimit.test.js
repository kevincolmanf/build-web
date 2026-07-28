import { beforeEach, expect, test } from 'vitest';
import { createRateLimit } from '../netlify/lib/rateLimit.js';

function fakeBlob() {
  const m = new Map();
  return {
    async get(k, o) { const v = m.get(k); return v == null ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
  };
}
let rl, blob;
beforeEach(() => { blob = fakeBlob(); rl = createRateLimit(blob, { cooldownDays: 14 }); });

test('primer uso: permitido', async () => {
  const r = await rl.checkPhone('hash1', Date.now());
  expect(r.allowed).toBe(true);
});

test('segundo uso dentro del cooldown: bloqueado con fecha', async () => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  await rl.recordPhone('hash1', now, 'BUILD-ABC123');
  const r = await rl.checkPhone('hash1', now + 1000 * 60 * 60 * 24 * 3); // 3 días después
  expect(r.allowed).toBe(false);
  expect(r.nextAllowedAt).toBe('2026-08-11T00:00:00.000Z');
});

test('después del cooldown: permitido de nuevo', async () => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  await rl.recordPhone('hash1', now, 'BUILD-ABC123');
  const r = await rl.checkPhone('hash1', now + 1000 * 60 * 60 * 24 * 15);
  expect(r.allowed).toBe(true);
});

import { beforeEach, expect, test } from 'vitest';
import { handleLookup, handleMark } from '../netlify/functions/redeem-lookup.js';
import { createCouponStore } from '../netlify/lib/couponStore.js';

function fakeBlob() {
  const m = new Map();
  return {
    async get(k, o) { const v = m.get(k); return v == null ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
  };
}
let store;
beforeEach(async () => {
  store = createCouponStore(fakeBlob());
  await store.saveCoupon({ code: 'BUILD-AAA111', discountPct: 8, name: 'Kevin', status: 'valid', expiresAt: '2999-01-01T00:00:00Z' });
});

test('lookup devuelve datos + estado efectivo', async () => {
  const r = await handleLookup('BUILD-AAA111', { store });
  expect(r.found).toBe(true);
  expect(r.discountPct).toBe(8);
  expect(r.status).toBe('valid');
});

test('lookup de inexistente', async () => {
  const r = await handleLookup('BUILD-NOPE00', { store });
  expect(r.found).toBe(false);
});

test('mark cambia a redeemed y rechaza segundo intento', async () => {
  const r1 = await handleMark('BUILD-AAA111', { store, now: () => Date.parse('2026-07-28T00:00:00Z') });
  expect(r1.ok).toBe(true);
  const r2 = await handleMark('BUILD-AAA111', { store, now: () => Date.now() });
  expect(r2.ok).toBe(false);
  expect(r2.reason).toMatch(/usado/);
});

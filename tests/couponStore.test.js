import { beforeEach, expect, test } from 'vitest';
import { createCouponStore } from '../netlify/lib/couponStore.js';

function fakeBlob() {
  const m = new Map();
  return {
    async get(k, opts) { const v = m.get(k); return v == null ? null : (opts?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, val) { m.set(k, JSON.stringify(val)); },
    async set(k, val) { m.set(k, val); },
    async list({ prefix } = {}) { return { blobs: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(key => ({ key })) }; },
    _m: m,
  };
}

let store, blob;
beforeEach(() => { blob = fakeBlob(); store = createCouponStore(blob); });

test('crea y lee cupón', async () => {
  await store.saveCoupon({ code: 'BUILD-ABC123', discountPct: 7, name: 'Kevin', phone: '+549221...', status: 'valid', createdAt: '2026-07-28T00:00:00Z', expiresAt: '2026-08-11T00:00:00Z' });
  const c = await store.getCoupon('BUILD-ABC123');
  expect(c.discountPct).toBe(7);
  expect(c.status).toBe('valid');
});

test('marca como usado (idempotente falla si ya usado)', async () => {
  await store.saveCoupon({ code: 'BUILD-ABC123', discountPct: 7, status: 'valid', expiresAt: '2999-01-01T00:00:00Z' });
  const r1 = await store.markRedeemed('BUILD-ABC123', '2026-07-29T00:00:00Z');
  expect(r1.status).toBe('redeemed');
  await expect(store.markRedeemed('BUILD-ABC123', '2026-07-30T00:00:00Z')).rejects.toThrow(/ya usado/);
});

test('lookup marca vencido si pasó expiresAt', async () => {
  await store.saveCoupon({ code: 'BUILD-OLD999', discountPct: 5, status: 'valid', expiresAt: '2000-01-01T00:00:00Z' });
  const c = await store.getCoupon('BUILD-OLD999');
  expect(store.effectiveStatus(c)).toBe('expired');
});

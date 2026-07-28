import { beforeEach, expect, test } from 'vitest';
import { handlePlay } from '../netlify/functions/play.js';
import { createCouponStore } from '../netlify/lib/couponStore.js';
import { createRateLimit } from '../netlify/lib/rateLimit.js';

function fakeBlob() {
  const m = new Map();
  return {
    async get(k, o) { const v = m.get(k); return v == null ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async list({ prefix } = {}) { return { blobs: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
function deps(evalResult) {
  const blob = fakeBlob();
  return {
    blob,
    config: { cooldownDays: 14, couponTtlDays: 14, minPurchaseArs: 5000, campaignActive: true },
    store: createCouponStore(blob),
    rateLimit: createRateLimit(blob, { cooldownDays: 14 }),
    evaluate: async () => evalResult,
    now: () => Date.parse('2026-07-28T00:00:00Z'),
  };
}

test('tip on-topic genera cupón con % y vencimiento a 14 días', async () => {
  const d = deps({ onTopic: true, score: 72, feedback: '¡Genial!', flags: [] });
  const r = await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: true, transcript: 'sentadillas con técnica' }, d);
  expect(r.status).toBe('won');
  expect(r.discountPct).toBe(8);
  expect(r.code).toMatch(/^BUILD-/);
  expect(r.expiresAt).toBe('2026-08-11T00:00:00.000Z');
  expect(r.minPurchaseArs).toBe(5000);
});

test('off-topic no genera cupón', async () => {
  const d = deps({ onTopic: false, score: 0, feedback: 'Contanos algo de entrenamiento', flags: [] });
  const r = await handlePlay({ name: 'X', phone: '+5492213997358', consent: true, transcript: 'hola' }, d);
  expect(r.status).toBe('offtopic');
  expect(r.code).toBeUndefined();
});

test('segundo intento del mismo teléfono en cooldown: bloqueado', async () => {
  const d = deps({ onTopic: true, score: 90, feedback: 'ok', flags: [] });
  await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: true, transcript: 'tip1' }, d);
  const r = await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: true, transcript: 'tip2' }, d);
  expect(r.status).toBe('cooldown');
  expect(r.nextAllowedAt).toBe('2026-08-11T00:00:00.000Z');
});

test('sin consentimiento: rechaza', async () => {
  const d = deps({ onTopic: true, score: 90, feedback: 'ok', flags: [] });
  const r = await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: false, transcript: 'tip' }, d);
  expect(r.status).toBe('error');
});

test('teléfono inválido: rechaza', async () => {
  const d = deps({ onTopic: true, score: 90, feedback: 'ok', flags: [] });
  const r = await handlePlay({ name: 'Kevin', phone: '123', consent: true, transcript: 'tip' }, d);
  expect(r.status).toBe('error');
});

test('campaña finalizada: rechaza', async () => {
  const d = deps({ onTopic: true, score: 90, feedback: 'ok', flags: [] });
  d.config.campaignActive = false;
  const r = await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: true, transcript: 'tip' }, d);
  expect(r.status).toBe('ended');
});

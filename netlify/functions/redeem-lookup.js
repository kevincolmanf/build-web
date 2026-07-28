import { getStore } from '@netlify/blobs';
import { loadConfig } from '../lib/config.js';
import { createCouponStore } from '../lib/couponStore.js';
import { checkStaff } from '../lib/auth.js';

export async function handleLookup(code, { store }) {
  const c = await store.getCoupon(code);
  if (!c) return { found: false };
  return { found: true, name: c.name, discountPct: c.discountPct, status: store.effectiveStatus(c), expiresAt: c.expiresAt };
}

export async function handleMark(code, { store, now = () => Date.now() }) {
  try {
    const c = await store.markRedeemed(code, new Date(now()).toISOString());
    return { ok: true, name: c.name, discountPct: c.discountPct };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export default async (req) => {
  const config = loadConfig();
  if (!checkStaff(req, config)) return new Response('No autorizado', { status: 401 });
  const { code } = await req.json();
  const store = createCouponStore(getStore('build-juego'));
  return Response.json(await handleLookup(code, { store }));
};

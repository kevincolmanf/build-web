import { getStore } from '@netlify/blobs';
import { loadConfig } from '../lib/config.js';
import { createCouponStore } from '../lib/couponStore.js';
import { checkStaff } from '../lib/auth.js';
import { handleMark } from './redeem-lookup.js';

export default async (req) => {
  const config = loadConfig();
  if (!checkStaff(req, config)) return new Response('No autorizado', { status: 401 });
  const { code } = await req.json();
  const store = createCouponStore(getStore('build-juego'));
  return Response.json(await handleMark(code, { store }));
};

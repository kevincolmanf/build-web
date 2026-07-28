import { getStore } from '@netlify/blobs';
import { loadConfig } from '../lib/config.js';
import { createCouponStore } from '../lib/couponStore.js';
import { checkStaff } from '../lib/auth.js';

export default async (req) => {
  const config = loadConfig();
  if (!checkStaff(req, config)) return new Response('No autorizado', { status: 401 });
  const store = createCouponStore(getStore('build-juego'));
  const leads = await store.listLeads();
  const rows = [['nombre', 'whatsapp', 'cupon', 'score', 'fecha']];
  for (const l of leads) rows.push([l.name, l.phone, l.couponCode, l.score, l.createdAt]);
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="contactos-build.csv"' } });
};

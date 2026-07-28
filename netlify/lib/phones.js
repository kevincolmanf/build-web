import { createHash } from 'node:crypto';

// Normaliza a E.164 argentino móvil: +549 + 10 dígitos (área + abonado).
export function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  d = d.replace(/^\+/, '');
  d = d.replace(/^0/, '');              // saca 0 inicial
  d = d.replace(/^549/, '');            // saca prefijo país+9
  d = d.replace(/^54/, '');
  d = d.replace(/15(?=\d{6,8}$)/, '');  // saca "15" de celular si quedó
  if (!/^\d{10}$/.test(d)) return null; // debe quedar área+abonado = 10 díg
  return `+549${d}`;
}

export function hashPhone(e164) {
  return createHash('sha256').update(String(e164)).digest('hex');
}

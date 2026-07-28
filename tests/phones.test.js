import { expect, test } from 'vitest';
import { normalizePhone, hashPhone } from '../netlify/lib/phones.js';

test('normaliza número argentino a E.164', () => {
  expect(normalizePhone('221 15 3997358')).toBe('+5492213997358');
  expect(normalizePhone('0221 15-399-7358')).toBe('+5492213997358');
});

test('acepta ya normalizado', () => {
  expect(normalizePhone('+5492213997358')).toBe('+5492213997358');
});

test('rechaza basura', () => {
  expect(normalizePhone('hola')).toBeNull();
  expect(normalizePhone('123')).toBeNull();
});

test('hash estable y no reversible obvio', () => {
  const h = hashPhone('+5492213997358');
  expect(h).toBe(hashPhone('+5492213997358'));
  expect(h).not.toContain('2213997358');
  expect(h).toMatch(/^[a-f0-9]{64}$/);
});

import { expect, test } from 'vitest';
import { generateCode, discountFromScore } from '../netlify/lib/coupons.js';

test('genera código con prefijo BUILD y 6 chars sin ambiguos', () => {
  const code = generateCode();
  expect(code).toMatch(/^BUILD-[A-HJ-NP-Z2-9]{6}$/);
});

test('códigos distintos entre llamadas', () => {
  expect(generateCode()).not.toBe(generateCode());
});

test('mapeo score -> % escalonado 5..10', () => {
  expect(discountFromScore(0)).toBe(5);
  expect(discountFromScore(20)).toBe(5);
  expect(discountFromScore(30)).toBe(6);
  expect(discountFromScore(50)).toBe(7);
  expect(discountFromScore(70)).toBe(8);
  expect(discountFromScore(90)).toBe(9);
  expect(discountFromScore(100)).toBe(10);
});

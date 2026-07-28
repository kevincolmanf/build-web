import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadConfig } from '../netlify/lib/config.js';

const OLD = { ...process.env };
beforeEach(() => { process.env = { ...OLD }; });
afterEach(() => { process.env = { ...OLD }; });

test('defaults sensatos cuando faltan env', () => {
  delete process.env.COUPON_TTL_DAYS;
  const c = loadConfig();
  expect(c.couponTtlDays).toBe(14);
  expect(c.maxAudioSeconds).toBe(60);
  expect(c.cooldownDays).toBe(14);
});

test('campaña activa/inactiva por fecha', () => {
  process.env.CAMPAIGN_END = '2000-01-01T00:00:00Z';
  expect(loadConfig().campaignActive).toBe(false);
  process.env.CAMPAIGN_END = '2999-01-01T00:00:00Z';
  expect(loadConfig().campaignActive).toBe(true);
});

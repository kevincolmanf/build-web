export function createRateLimit(blob, { cooldownDays = 14 } = {}) {
  const key = (hash) => `phone:${hash}`;
  const ms = cooldownDays * 24 * 60 * 60 * 1000;
  return {
    async checkPhone(hash, nowMs = Date.now()) {
      const rec = await blob.get(key(hash), { type: 'json' });
      if (!rec?.lastCouponAt) return { allowed: true };
      const last = new Date(rec.lastCouponAt).getTime();
      if (nowMs - last >= ms) return { allowed: true };
      return { allowed: false, nextAllowedAt: new Date(last + ms).toISOString() };
    },
    async recordPhone(hash, nowMs, code) {
      await blob.setJSON(key(hash), { lastCouponAt: new Date(nowMs).toISOString(), lastCode: code });
    },
  };
}

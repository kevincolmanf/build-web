export function createCouponStore(blob) {
  const key = (code) => `coupon:${code}`;
  return {
    effectiveStatus(c) {
      if (!c) return 'notfound';
      if (c.status === 'redeemed') return 'redeemed';
      if (c.expiresAt && Date.now() > new Date(c.expiresAt).getTime()) return 'expired';
      return 'valid';
    },
    async saveCoupon(c) { await blob.setJSON(key(c.code), c); return c; },
    async getCoupon(code) { return blob.get(key(code), { type: 'json' }); },
    async saveLead(lead) { await blob.setJSON(`lead:${lead.couponCode}`, lead); },
    async markRedeemed(code, nowIso) {
      const c = await blob.get(key(code), { type: 'json' });
      if (!c) throw new Error('cupón inexistente');
      if (c.status === 'redeemed') throw new Error('cupón ya usado');
      if (c.expiresAt && Date.now() > new Date(c.expiresAt).getTime()) throw new Error('cupón vencido');
      c.status = 'redeemed';
      c.redeemedAt = nowIso;
      await blob.setJSON(key(code), c);
      return c;
    },
    async listLeads() {
      const { blobs } = await blob.list({ prefix: 'lead:' });
      const out = [];
      for (const b of blobs) out.push(await blob.get(b.key, { type: 'json' }));
      return out;
    },
  };
}

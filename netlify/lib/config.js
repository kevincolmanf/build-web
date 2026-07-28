export function loadConfig(env = process.env) {
  const end = env.CAMPAIGN_END ? new Date(env.CAMPAIGN_END) : null;
  return {
    couponTtlDays: Number(env.COUPON_TTL_DAYS ?? 14),
    cooldownDays: Number(env.COOLDOWN_DAYS ?? 14),
    maxAudioSeconds: Number(env.MAX_AUDIO_SECONDS ?? 60),
    minPurchaseArs: Number(env.MIN_PURCHASE_ARS ?? 0),
    ratePerHour: Number(env.RATE_PER_HOUR ?? 10),
    campaignEnd: end,
    campaignActive: end ? Date.now() < end.getTime() : true,
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    staffPassword: env.STAFF_PASSWORD,
    claudeModel: env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001',
  };
}

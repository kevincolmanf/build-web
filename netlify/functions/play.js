import { getStore } from '@netlify/blobs';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { loadConfig } from '../lib/config.js';
import { createCouponStore } from '../lib/couponStore.js';
import { createRateLimit } from '../lib/rateLimit.js';
import { normalizePhone, hashPhone } from '../lib/phones.js';
import { generateCode, discountFromScore } from '../lib/coupons.js';
import { evaluateTip } from '../lib/evaluate.js';
import { transcribeAudio } from '../lib/transcribe.js';

// Lógica pura (testeable). input.transcript ya resuelto.
export async function handlePlay(input, deps) {
  const { config, store, rateLimit, evaluate, now } = deps;
  if (!config.campaignActive) return { status: 'ended' };
  if (!input.consent) return { status: 'error', message: 'Necesitás aceptar las condiciones.' };
  const phone = normalizePhone(input.phone);
  if (!phone) return { status: 'error', message: 'Poné un WhatsApp válido.' };
  if (!input.name || String(input.name).trim().length < 1) return { status: 'error', message: 'Poné tu nombre.' };
  if (!input.transcript || input.transcript.trim().length < 3) return { status: 'error', message: 'No te escuchamos bien, probá de nuevo.' };

  const hash = hashPhone(phone);
  const nowMs = now();
  const gate = await rateLimit.checkPhone(hash, nowMs);
  if (!gate.allowed) return { status: 'cooldown', nextAllowedAt: gate.nextAllowedAt };

  const ev = await evaluate(input.transcript);
  if (!ev.onTopic || ev.flags.includes('spam') || ev.flags.includes('abuse')) {
    return { status: 'offtopic', feedback: ev.feedback || 'Contanos un tip real de entrenamiento 😉' };
  }

  const discountPct = discountFromScore(ev.score);
  const code = generateCode();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + config.couponTtlDays * 86400000).toISOString();
  const coupon = { code, discountPct, name: input.name.trim(), phone, status: 'valid', createdAt, expiresAt, score: ev.score, transcriptExcerpt: input.transcript.slice(0, 120) };
  await store.saveCoupon(coupon);
  await store.saveLead({ name: input.name.trim(), phone, couponCode: code, score: ev.score, createdAt, consent: true });
  await rateLimit.recordPhone(hash, nowMs, code);

  return { status: 'won', feedback: ev.feedback, discountPct, code, expiresAt, minPurchaseArs: config.minPurchaseArs };
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const config = loadConfig();
  try {
    const form = await req.formData();
    const name = form.get('name');
    const phone = form.get('phone');
    const consent = form.get('consent') === 'true';
    const audio = form.get('audio'); // File

    let transcript = '';
    if (audio && typeof audio !== 'string') {
      const openai = new OpenAI({ apiKey: config.openaiKey });
      transcript = await transcribeAudio(audio, { client: openai });
    }

    const blob = getStore('build-juego');
    const anthropic = new Anthropic({ apiKey: config.anthropicKey });
    const deps = {
      config,
      store: createCouponStore(blob),
      rateLimit: createRateLimit(blob, { cooldownDays: config.cooldownDays }),
      evaluate: (t) => evaluateTip(t, { client: anthropic, model: config.claudeModel }),
      now: () => Date.now(),
    };
    const result = await handlePlay({ name, phone, consent, transcript }, deps);
    return Response.json(result);
  } catch (err) {
    console.error('play error', err);
    return Response.json({ status: 'error', message: 'Ups, probá de nuevo en un ratito.' }, { status: 200 });
  }
};

# Juego con IA "Contá tu tip y ganá" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar a `buildfit.com.ar` un juego donde la persona graba un audio con un tip de entrenamiento/salud, la IA lo evalúa y entrega un cupón de descuento (5–10%) de un solo uso con vencimiento a 14 días, canjeable en el mostrador físico.

**Architecture:** Sitio estático actual + **Netlify Functions** (serverless, mismo hosting). El navegador graba audio y lo manda a `/api/play`; la function transcribe con **Whisper (OpenAI)**, evalúa con **Claude (Anthropic)**, genera y persiste el cupón en **Netlify Blobs**, y responde con la devolución + código. Un panel `/canje` protegido con contraseña valida y marca cupones. Las API keys viven server-side.

**Tech Stack:** HTML + Tailwind (CDN, ya en uso) para el front; Node 18 ESM para las functions; `@anthropic-ai/sdk`, `openai`, `@netlify/blobs`; `vitest` para tests; Netlify CLI para dev/deploy.

**Spec de referencia:** `docs/superpowers/specs/2026-07-28-juego-cupones-ia-design.md`

---

## File Structure

```
netlify.toml                 # config Netlify (functions dir + redirects /api/*)
package.json                 # deps + scripts (test, dev)
vitest.config.js
.gitignore                   # sumar node_modules, .netlify, .env, .superpowers
netlify/functions/
  play.js                    # POST /api/play  (endpoint principal del juego)
  redeem-lookup.js           # POST /api/redeem/lookup  (staff)
  redeem-mark.js             # POST /api/redeem/mark     (staff)
  export.js                  # GET  /api/export          (staff, CSV)
netlify/lib/
  config.js                  # lee env vars + defaults de campaña
  coupons.js                 # generateCode, discountFromScore (lógica pura)
  couponStore.js             # CRUD de cupones/leads sobre Netlify Blobs
  phones.js                  # normalizePhone, hashPhone (lógica pura)
  rateLimit.js               # checkPhoneCooldown sobre Blobs
  transcribe.js              # Whisper: audio -> texto
  evaluate.js                # Claude: transcript -> {onTopic, score, feedback, flags}
  auth.js                    # verifica contraseña de staff
juego.html                   # pantalla del juego (bienvenida -> grabar -> resultado)
canje.html                   # panel del mostrador
bases-y-condiciones.html     # legales
tests/
  coupons.test.js
  phones.test.js
  couponStore.test.js
  rateLimit.test.js
  evaluate.test.js
  play.test.js
  redeem.test.js
```

**Convención Blobs (store "build-juego"):**
- `coupon:<CODE>` → objeto cupón
- `phone:<hash>` → `{ lastCouponAt, lastCode }`
- `lead:<CODE>` → objeto lead

---

## Task 1: Setup del proyecto Node + Netlify Functions + tests

**Files:**
- Create: `package.json`, `netlify.toml`, `vitest.config.js`, `netlify/functions/ping.js`, `tests/ping.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "build-web",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "netlify dev"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.1",
    "@netlify/blobs": "^8.1.0",
    "openai": "^4.73.0"
  },
  "devDependencies": {
    "netlify-cli": "^17.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Crear `netlify.toml`**

```toml
[build]
  publish = "."
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/play"
  to = "/.netlify/functions/play"
  status = 200
[[redirects]]
  from = "/api/redeem/lookup"
  to = "/.netlify/functions/redeem-lookup"
  status = 200
[[redirects]]
  from = "/api/redeem/mark"
  to = "/.netlify/functions/redeem-mark"
  status = 200
[[redirects]]
  from = "/api/export"
  to = "/.netlify/functions/export"
  status = 200
```

- [ ] **Step 3: Crear `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 4: Actualizar `.gitignore`** (crear si no existe; agregar estas líneas)

```
node_modules/
.netlify/
.env
.superpowers/
.DS_Store
```

- [ ] **Step 5: Crear function de humo `netlify/functions/ping.js`**

```js
export default async () => Response.json({ ok: true, service: 'build-juego' });
```

- [ ] **Step 6: Test de humo `tests/ping.test.js`**

```js
import { expect, test } from 'vitest';
import ping from '../netlify/functions/ping.js';

test('ping responde ok', async () => {
  const res = await ping(new Request('http://x/api/ping'));
  const body = await res.json();
  expect(body.ok).toBe(true);
});
```

- [ ] **Step 7: Instalar y correr**

Run: `npm install && npm test`
Expected: 1 test PASS (`ping responde ok`).

- [ ] **Step 8: Commit**

```bash
git add package.json netlify.toml vitest.config.js .gitignore netlify/functions/ping.js tests/ping.test.js
git commit -m "chore: setup Netlify Functions + vitest"
```

---

## Task 2: Config de campaña (`netlify/lib/config.js`)

**Files:**
- Create: `netlify/lib/config.js`, `tests/config.test.js`

- [ ] **Step 1: Test `tests/config.test.js`**

```js
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
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/config.test.js`
Expected: FAIL (`loadConfig` no existe).

- [ ] **Step 3: Implementar `netlify/lib/config.js`**

```js
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
```

- [ ] **Step 4: Correr tests** — Run: `npx vitest run tests/config.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/config.js tests/config.test.js
git commit -m "feat: config de campaña con defaults"
```

---

## Task 3: Cupones — lógica pura (`netlify/lib/coupons.js`)

**Files:**
- Create: `netlify/lib/coupons.js`, `tests/coupons.test.js`

- [ ] **Step 1: Test `tests/coupons.test.js`**

```js
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
```

- [ ] **Step 2: Verificar que falla** — Run: `npx vitest run tests/coupons.test.js` — Expected: FAIL.

- [ ] **Step 3: Implementar `netlify/lib/coupons.js`**

```js
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I,O,0,1

export function generateCode() {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `BUILD-${s}`;
}

export function discountFromScore(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s <= 20) return 5;
  if (s <= 40) return 6;
  if (s <= 60) return 7;
  if (s <= 80) return 8;
  if (s <= 95) return 9;
  return 10;
}
```

- [ ] **Step 4: Correr tests** — Run: `npx vitest run tests/coupons.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/coupons.js tests/coupons.test.js
git commit -m "feat: generación de código y mapeo score->descuento"
```

---

## Task 4: Teléfonos — normalización y hash (`netlify/lib/phones.js`)

**Files:**
- Create: `netlify/lib/phones.js`, `tests/phones.test.js`

- [ ] **Step 1: Test `tests/phones.test.js`**

```js
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
```

> Nota: `normalizePhone` debe devolver `+549` + (código de área + número, 10 dígitos) para Argentina móvil. Ver implementación.

- [ ] **Step 2: Verificar que falla** — Run: `npx vitest run tests/phones.test.js` — Expected: FAIL.

- [ ] **Step 3: Implementar `netlify/lib/phones.js`**

```js
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
```

- [ ] **Step 4: Correr tests** — Run: `npx vitest run tests/phones.test.js` — Expected: PASS. Si algún caso de borde falla, ajustar los `replace` y re-correr (documentar el número de ejemplo real de Build: `+5492213997358`).

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/phones.js tests/phones.test.js
git commit -m "feat: normalización y hash de teléfono AR"
```

---

## Task 5: Store de cupones/leads sobre Blobs (`netlify/lib/couponStore.js`)

**Files:**
- Create: `netlify/lib/couponStore.js`, `tests/couponStore.test.js`

**Diseño:** `createCouponStore(blobStore)` recibe un store con API `{ get(key), setJSON(key,val), set(key,val), list(opts) }` para poder inyectar un fake en tests. En producción se envuelve `@netlify/blobs`.

- [ ] **Step 1: Test `tests/couponStore.test.js`**

```js
import { beforeEach, expect, test } from 'vitest';
import { createCouponStore } from '../netlify/lib/couponStore.js';

function fakeBlob() {
  const m = new Map();
  return {
    async get(k, opts) { const v = m.get(k); return v == null ? null : (opts?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, val) { m.set(k, JSON.stringify(val)); },
    async set(k, val) { m.set(k, val); },
    async list({ prefix } = {}) { return { blobs: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(key => ({ key })) }; },
    _m: m,
  };
}

let store, blob;
beforeEach(() => { blob = fakeBlob(); store = createCouponStore(blob); });

test('crea y lee cupón', async () => {
  await store.saveCoupon({ code: 'BUILD-ABC123', discountPct: 7, name: 'Kevin', phone: '+549221...', status: 'valid', createdAt: '2026-07-28T00:00:00Z', expiresAt: '2026-08-11T00:00:00Z' });
  const c = await store.getCoupon('BUILD-ABC123');
  expect(c.discountPct).toBe(7);
  expect(c.status).toBe('valid');
});

test('marca como usado (idempotente falla si ya usado)', async () => {
  await store.saveCoupon({ code: 'BUILD-ABC123', discountPct: 7, status: 'valid', expiresAt: '2999-01-01T00:00:00Z' });
  const r1 = await store.markRedeemed('BUILD-ABC123', '2026-07-29T00:00:00Z');
  expect(r1.status).toBe('redeemed');
  await expect(store.markRedeemed('BUILD-ABC123', '2026-07-30T00:00:00Z')).rejects.toThrow(/ya usado/);
});

test('lookup marca vencido si pasó expiresAt', async () => {
  await store.saveCoupon({ code: 'BUILD-OLD999', discountPct: 5, status: 'valid', expiresAt: '2000-01-01T00:00:00Z' });
  const c = await store.getCoupon('BUILD-OLD999');
  expect(store.effectiveStatus(c)).toBe('expired');
});
```

- [ ] **Step 2: Verificar que falla** — Run: `npx vitest run tests/couponStore.test.js` — Expected: FAIL.

- [ ] **Step 3: Implementar `netlify/lib/couponStore.js`**

```js
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
```

- [ ] **Step 4: Correr tests** — Run: `npx vitest run tests/couponStore.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/couponStore.js tests/couponStore.test.js
git commit -m "feat: store de cupones/leads sobre Blobs (inyectable)"
```

---

## Task 6: Rate-limit por teléfono (`netlify/lib/rateLimit.js`)

**Files:**
- Create: `netlify/lib/rateLimit.js`, `tests/rateLimit.test.js`

- [ ] **Step 1: Test `tests/rateLimit.test.js`**

```js
import { beforeEach, expect, test } from 'vitest';
import { createRateLimit } from '../netlify/lib/rateLimit.js';

function fakeBlob() {
  const m = new Map();
  return {
    async get(k, o) { const v = m.get(k); return v == null ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
  };
}
let rl, blob;
beforeEach(() => { blob = fakeBlob(); rl = createRateLimit(blob, { cooldownDays: 14 }); });

test('primer uso: permitido', async () => {
  const r = await rl.checkPhone('hash1', Date.now());
  expect(r.allowed).toBe(true);
});

test('segundo uso dentro del cooldown: bloqueado con fecha', async () => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  await rl.recordPhone('hash1', now, 'BUILD-ABC123');
  const r = await rl.checkPhone('hash1', now + 1000 * 60 * 60 * 24 * 3); // 3 días después
  expect(r.allowed).toBe(false);
  expect(r.nextAllowedAt).toBe('2026-08-11T00:00:00.000Z');
});

test('después del cooldown: permitido de nuevo', async () => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  await rl.recordPhone('hash1', now, 'BUILD-ABC123');
  const r = await rl.checkPhone('hash1', now + 1000 * 60 * 60 * 24 * 15);
  expect(r.allowed).toBe(true);
});
```

- [ ] **Step 2: Verificar que falla** — Run: `npx vitest run tests/rateLimit.test.js` — Expected: FAIL.

- [ ] **Step 3: Implementar `netlify/lib/rateLimit.js`**

```js
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
```

- [ ] **Step 4: Correr tests** — Run: `npx vitest run tests/rateLimit.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/rateLimit.js tests/rateLimit.test.js
git commit -m "feat: rate-limit por teléfono (cooldown 14 días)"
```

---

## Task 7: Evaluación con Claude (`netlify/lib/evaluate.js`)

**Files:**
- Create: `netlify/lib/evaluate.js`, `tests/evaluate.test.js`

**Diseño:** `evaluateTip(transcript, { client, model })` recibe un cliente Anthropic inyectable. Devuelve `{ onTopic, score, feedback, flags }` parseado del JSON que responde Claude.

- [ ] **Step 1: Test `tests/evaluate.test.js`**

```js
import { expect, test } from 'vitest';
import { evaluateTip, buildPrompt } from '../netlify/lib/evaluate.js';

function fakeClient(jsonText) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: jsonText }] }) } };
}

test('parsea respuesta on-topic', async () => {
  const client = fakeClient('{"onTopic":true,"score":72,"feedback":"¡Buenísimo tu tip!","flags":[]}');
  const r = await evaluateTip('tomá agua y descansá', { client, model: 'm' });
  expect(r.onTopic).toBe(true);
  expect(r.score).toBe(72);
  expect(r.feedback).toContain('Buenísimo');
});

test('parsea off-topic', async () => {
  const client = fakeClient('{"onTopic":false,"score":0,"feedback":"Contanos algo de entrenamiento 😉","flags":[]}');
  const r = await evaluateTip('hola que tal', { client, model: 'm' });
  expect(r.onTopic).toBe(false);
});

test('el prompt incluye la transcripción y pide JSON', () => {
  const p = buildPrompt('mi tip sobre sentadillas');
  expect(p).toContain('mi tip sobre sentadillas');
  expect(p.toLowerCase()).toContain('json');
});

test('tolera texto con ruido alrededor del JSON', async () => {
  const client = fakeClient('claro:\n{"onTopic":true,"score":50,"feedback":"ok","flags":[]}\ngracias');
  const r = await evaluateTip('algo', { client, model: 'm' });
  expect(r.score).toBe(50);
});
```

- [ ] **Step 2: Verificar que falla** — Run: `npx vitest run tests/evaluate.test.js` — Expected: FAIL.

- [ ] **Step 3: Implementar `netlify/lib/evaluate.js`**

```js
export function buildPrompt(transcript) {
  return `Sos el evaluador del juego de Build (centro de kinesiología y entrenamiento en La Plata).
La persona dejó un audio con un "tip" sobre entrenamiento, salud, kinesiología o nutrición.
Transcripción del audio:
"""${transcript}"""

Devolvé SOLO un objeto JSON válido (sin texto extra) con esta forma:
{"onTopic": boolean, "score": number (0-100), "feedback": string, "flags": string[]}

Reglas:
- onTopic=true solo si realmente habla de entrenamiento/salud/kinesiología/nutrición.
- score: qué tan claro, completo y valioso es el tip (0-100).
- feedback: 1-2 frases, tono canchero pero serio, tuteo argentino, positivo y humano. Máx 240 caracteres.
- Si detectás un consejo potencialmente riesgoso (dosis, lesiones), no lo valides como verdad; sugerí consultarlo con el equipo de Build, pero podés mantener onTopic=true si el intento es genuino.
- flags: incluí "spam" si es ruido/vacío, "abuse" si es ofensivo. Si no, [].`;
}

export async function evaluateTip(transcript, { client, model }) {
  const res = await client.messages.create({
    model,
    max_tokens: 400,
    messages: [{ role: 'user', content: buildPrompt(transcript) }],
  });
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('respuesta IA sin JSON');
  const data = JSON.parse(text.slice(start, end + 1));
  return {
    onTopic: Boolean(data.onTopic),
    score: Math.max(0, Math.min(100, Number(data.score) || 0)),
    feedback: String(data.feedback || '').slice(0, 240),
    flags: Array.isArray(data.flags) ? data.flags : [],
  };
}
```

- [ ] **Step 4: Correr tests** — Run: `npx vitest run tests/evaluate.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/evaluate.js tests/evaluate.test.js
git commit -m "feat: evaluación de tips con Claude (prompt + parseo)"
```

---

## Task 8: Transcripción con Whisper (`netlify/lib/transcribe.js`)

**Files:**
- Create: `netlify/lib/transcribe.js`

> Sin test unitario (es un wrapper fino sobre el SDK de OpenAI). Se valida en el test de integración de `play` con cliente mockeado y en la prueba manual (Task 13).

- [ ] **Step 1: Implementar `netlify/lib/transcribe.js`**

```js
// audioFile: un File/Blob con el audio (webm/mp4/mp3). Devuelve texto.
export async function transcribeAudio(audioFile, { client }) {
  const res = await client.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'es',
  });
  return (res.text || '').trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add netlify/lib/transcribe.js
git commit -m "feat: wrapper de transcripción Whisper"
```

---

## Task 9: Endpoint principal `POST /api/play` (`netlify/functions/play.js`)

**Files:**
- Create: `netlify/functions/play.js`, `tests/play.test.js`

**Diseño para testeo:** la lógica va en `handlePlay(input, deps)` (pura respecto a IO, con deps inyectables); el handler de Netlify arma `deps` reales y llama a `handlePlay`. `input = { name, phone, consent, transcript }` (en el test pasamos `transcript` ya resuelto; en prod la function transcribe el audio antes). `deps = { config, store, rateLimit, evaluate, now }`.

- [ ] **Step 1: Test `tests/play.test.js`**

```js
import { beforeEach, expect, test } from 'vitest';
import { handlePlay } from '../netlify/functions/play.js';
import { createCouponStore } from '../netlify/lib/couponStore.js';
import { createRateLimit } from '../netlify/lib/rateLimit.js';

function fakeBlob() {
  const m = new Map();
  return {
    async get(k, o) { const v = m.get(k); return v == null ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async list({ prefix } = {}) { return { blobs: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
function deps(evalResult) {
  const blob = fakeBlob();
  return {
    blob,
    config: { cooldownDays: 14, couponTtlDays: 14, minPurchaseArs: 5000, campaignActive: true },
    store: createCouponStore(blob),
    rateLimit: createRateLimit(blob, { cooldownDays: 14 }),
    evaluate: async () => evalResult,
    now: () => Date.parse('2026-07-28T00:00:00Z'),
  };
}

test('tip on-topic genera cupón con % y vencimiento a 14 días', async () => {
  const d = deps({ onTopic: true, score: 72, feedback: '¡Genial!', flags: [] });
  const r = await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: true, transcript: 'sentadillas con técnica' }, d);
  expect(r.status).toBe('won');
  expect(r.discountPct).toBe(8);
  expect(r.code).toMatch(/^BUILD-/);
  expect(r.expiresAt).toBe('2026-08-11T00:00:00.000Z');
  expect(r.minPurchaseArs).toBe(5000);
});

test('off-topic no genera cupón', async () => {
  const d = deps({ onTopic: false, score: 0, feedback: 'Contanos algo de entrenamiento', flags: [] });
  const r = await handlePlay({ name: 'X', phone: '+5492213997358', consent: true, transcript: 'hola' }, d);
  expect(r.status).toBe('offtopic');
  expect(r.code).toBeUndefined();
});

test('segundo intento del mismo teléfono en cooldown: bloqueado', async () => {
  const d = deps({ onTopic: true, score: 90, feedback: 'ok', flags: [] });
  await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: true, transcript: 'tip1' }, d);
  const r = await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: true, transcript: 'tip2' }, d);
  expect(r.status).toBe('cooldown');
  expect(r.nextAllowedAt).toBe('2026-08-11T00:00:00.000Z');
});

test('sin consentimiento: rechaza', async () => {
  const d = deps({ onTopic: true, score: 90, feedback: 'ok', flags: [] });
  const r = await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: false, transcript: 'tip' }, d);
  expect(r.status).toBe('error');
});

test('teléfono inválido: rechaza', async () => {
  const d = deps({ onTopic: true, score: 90, feedback: 'ok', flags: [] });
  const r = await handlePlay({ name: 'Kevin', phone: '123', consent: true, transcript: 'tip' }, d);
  expect(r.status).toBe('error');
});

test('campaña finalizada: rechaza', async () => {
  const d = deps({ onTopic: true, score: 90, feedback: 'ok', flags: [] });
  d.config.campaignActive = false;
  const r = await handlePlay({ name: 'Kevin', phone: '+5492213997358', consent: true, transcript: 'tip' }, d);
  expect(r.status).toBe('ended');
});
```

- [ ] **Step 2: Verificar que falla** — Run: `npx vitest run tests/play.test.js` — Expected: FAIL.

- [ ] **Step 3: Implementar `handlePlay` + handler en `netlify/functions/play.js`**

```js
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
  if (!input.name || String(input.name).trim().length < 2) return { status: 'error', message: 'Poné tu nombre.' };
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
```

- [ ] **Step 4: Correr tests** — Run: `npx vitest run tests/play.test.js` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/play.js tests/play.test.js
git commit -m "feat: endpoint /api/play (orquesta transcripción, IA, cupón, anti-abuso)"
```

---

## Task 10: Auth de staff + endpoints de canje

**Files:**
- Create: `netlify/lib/auth.js`, `netlify/functions/redeem-lookup.js`, `netlify/functions/redeem-mark.js`, `tests/redeem.test.js`

- [ ] **Step 1: Test `tests/redeem.test.js`**

```js
import { beforeEach, expect, test } from 'vitest';
import { handleLookup, handleMark } from '../netlify/functions/redeem-lookup.js';
import { createCouponStore } from '../netlify/lib/couponStore.js';

function fakeBlob() {
  const m = new Map();
  return {
    async get(k, o) { const v = m.get(k); return v == null ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
  };
}
let store;
beforeEach(async () => {
  store = createCouponStore(fakeBlob());
  await store.saveCoupon({ code: 'BUILD-AAA111', discountPct: 8, name: 'Kevin', status: 'valid', expiresAt: '2999-01-01T00:00:00Z' });
});

test('lookup devuelve datos + estado efectivo', async () => {
  const r = await handleLookup('BUILD-AAA111', { store });
  expect(r.found).toBe(true);
  expect(r.discountPct).toBe(8);
  expect(r.status).toBe('valid');
});

test('lookup de inexistente', async () => {
  const r = await handleLookup('BUILD-NOPE00', { store });
  expect(r.found).toBe(false);
});

test('mark cambia a redeemed y rechaza segundo intento', async () => {
  const r1 = await handleMark('BUILD-AAA111', { store, now: () => Date.parse('2026-07-28T00:00:00Z') });
  expect(r1.ok).toBe(true);
  const r2 = await handleMark('BUILD-AAA111', { store, now: () => Date.now() });
  expect(r2.ok).toBe(false);
  expect(r2.reason).toMatch(/usado/);
});
```

- [ ] **Step 2: Verificar que falla** — Run: `npx vitest run tests/redeem.test.js` — Expected: FAIL.

- [ ] **Step 3: Implementar `netlify/lib/auth.js`**

```js
export function checkStaff(req, config) {
  const token = req.headers.get('x-staff-token') || '';
  return Boolean(config.staffPassword) && token === config.staffPassword;
}
```

- [ ] **Step 4: Implementar `netlify/functions/redeem-lookup.js`** (exporta lógica + handler; `redeem-mark.js` reusa las funciones)

```js
import { getStore } from '@netlify/blobs';
import { loadConfig } from '../lib/config.js';
import { createCouponStore } from '../lib/couponStore.js';
import { checkStaff } from '../lib/auth.js';

export async function handleLookup(code, { store }) {
  const c = await store.getCoupon(code);
  if (!c) return { found: false };
  return { found: true, name: c.name, discountPct: c.discountPct, status: store.effectiveStatus(c), expiresAt: c.expiresAt };
}

export async function handleMark(code, { store, now = () => Date.now() }) {
  try {
    const c = await store.markRedeemed(code, new Date(now()).toISOString());
    return { ok: true, name: c.name, discountPct: c.discountPct };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export default async (req) => {
  const config = loadConfig();
  if (!checkStaff(req, config)) return new Response('No autorizado', { status: 401 });
  const { code } = await req.json();
  const store = createCouponStore(getStore('build-juego'));
  return Response.json(await handleLookup(code, { store }));
};
```

- [ ] **Step 5: Implementar `netlify/functions/redeem-mark.js`**

```js
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
```

- [ ] **Step 6: Correr tests** — Run: `npx vitest run tests/redeem.test.js` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add netlify/lib/auth.js netlify/functions/redeem-lookup.js netlify/functions/redeem-mark.js tests/redeem.test.js
git commit -m "feat: endpoints de canje (lookup/mark) con auth de staff"
```

---

## Task 11: Export CSV de contactos (`netlify/functions/export.js`)

**Files:**
- Create: `netlify/functions/export.js`

> Verificación manual en Task 13 (requiere Blobs real). Sin test unitario nuevo (usa `store.listLeads`, ya testeado).

- [ ] **Step 1: Implementar `netlify/functions/export.js`**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add netlify/functions/export.js
git commit -m "feat: export CSV de contactos (staff)"
```

---

## Task 12: Frontend del juego (`juego.html`)

**Files:**
- Create: `juego.html`, `bases-y-condiciones.html`
- Modify: `index.html` (agregar botón de entrada)

Sigue el sistema visual del sitio (negro/blanco + verde `#A6D60A`, Montserrat). 3 vistas en una sola página, alternadas por JS: `bienvenida` → `grabar` → `resultado`.

- [ ] **Step 1: Crear `juego.html`** con las 3 vistas, formulario Nombre+WhatsApp+consentimiento, grabación con `MediaRecorder`, y envío a `/api/play`.

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ganá tu descuento - Build</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;800;900&display=swap" rel="stylesheet" />
  <style>
    body { background:#111; color:#fff; font-family:'Montserrat',sans-serif; }
    .acid { color:#A6D60A; } .bg-acid { background:#A6D60A; }
    .hidden { display:none; }
    .rec-dot { width:14px;height:14px;border-radius:50%;background:#A6D60A;display:inline-block; animation:pulse 1s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  </style>
</head>
<body class="min-h-screen flex flex-col items-center justify-center px-6 py-10 text-center">
  <a href="/" class="fixed top-4 left-4 font-black text-xl">BUILD.</a>

  <!-- Vista 1: Bienvenida -->
  <section id="v-welcome" class="max-w-md">
    <h1 class="text-4xl md:text-5xl font-black uppercase leading-none mb-4">Contá tu <span class="acid">tip</span> y ganá</h1>
    <p class="font-bold text-gray-300 mb-8">Dejanos un audio con tu mejor consejo de entrenamiento o salud y llevate <span class="acid">5% a 10%</span> en suplementos y dietética. ¡Todos ganan!</p>
    <button id="btn-start" class="bg-acid text-black font-black uppercase text-xl px-8 py-4 rounded-full">Empezar</button>
    <p class="text-xs text-gray-500 mt-6">Válido con compra mínima. <a href="/bases-y-condiciones.html" class="underline">Bases y condiciones</a>.</p>
  </section>

  <!-- Vista 2: Datos + Grabar -->
  <section id="v-record" class="hidden max-w-md w-full">
    <input id="in-name" placeholder="TU NOMBRE" class="w-full mb-3 px-4 py-3 rounded-xl bg-white text-black font-bold uppercase" />
    <input id="in-phone" placeholder="TU WHATSAPP (EJ. 221...)" inputmode="tel" class="w-full mb-3 px-4 py-3 rounded-xl bg-white text-black font-bold uppercase" />
    <label class="flex items-start gap-2 text-left text-xs text-gray-400 mb-6">
      <input id="in-consent" type="checkbox" class="mt-1" />
      <span>Acepto que Build guarde mi contacto y me escriba con novedades. <a href="/bases-y-condiciones.html" class="underline">Bases y condiciones</a>.</span>
    </label>
    <div class="mb-4">
      <button id="btn-rec" class="bg-acid text-black font-black uppercase px-6 py-6 rounded-full text-lg w-full">🎤 Grabar mi tip</button>
      <p id="rec-status" class="text-sm text-gray-400 mt-3"></p>
      <audio id="preview" controls class="hidden w-full mt-3"></audio>
    </div>
    <button id="btn-send" class="hidden bg-white text-black font-black uppercase px-8 py-4 rounded-full w-full">Enviar y ver mi premio</button>
    <p id="rec-error" class="text-red-400 text-sm mt-3"></p>
  </section>

  <!-- Vista 3: Procesando -->
  <section id="v-loading" class="hidden">
    <span class="rec-dot"></span>
    <p class="font-black uppercase text-2xl mt-4">Analizando tu tip…</p>
  </section>

  <!-- Vista 4: Resultado -->
  <section id="v-result" class="hidden max-w-md">
    <p id="res-feedback" class="font-bold text-lg mb-6"></p>
    <div id="res-prize" class="hidden">
      <p class="uppercase text-gray-400 font-bold text-sm">Ganaste</p>
      <p class="text-7xl font-black acid leading-none mb-4"><span id="res-pct"></span>%</p>
      <div class="bg-white text-black rounded-2xl p-6 mb-4">
        <p class="uppercase text-xs font-bold text-gray-500">Tu código</p>
        <p id="res-code" class="text-3xl font-black tracking-wider"></p>
      </div>
      <p class="text-sm text-gray-400">Mostralo en el mostrador de Build. Vence el <span id="res-exp"></span>. <span id="res-min"></span></p>
    </div>
  </section>

  <script>
    const $ = (id) => document.getElementById(id);
    const show = (id) => ['v-welcome','v-record','v-loading','v-result'].forEach(v => $(v).classList.toggle('hidden', v !== id));

    $('btn-start').onclick = () => show('v-record');

    const MAX_SECONDS = 60;
    let mediaRecorder, chunks = [], audioBlob = null, autoStop = null, recording = false;
    async function startRec() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        chunks = [];
        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = () => {
          audioBlob = new Blob(chunks, { type: 'audio/webm' });
          $('preview').src = URL.createObjectURL(audioBlob);
          $('preview').classList.remove('hidden');
          $('btn-send').classList.remove('hidden');
          stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorder.start();
        recording = true;
        $('btn-rec').textContent = '⏹ Terminar';
        $('rec-status').innerHTML = '<span class="rec-dot"></span> Grabando… (máx 60s)';
        autoStop = setTimeout(stopRec, MAX_SECONDS * 1000);
      } catch (e) {
        $('rec-error').textContent = 'No pudimos acceder al micrófono. Habilitalo y probá de nuevo.';
      }
    }
    function stopRec() {
      if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); }
      clearTimeout(autoStop);
      recording = false;
      $('btn-rec').textContent = '🎤 Regrabar';
      $('rec-status').textContent = 'Escuchá tu audio o regrabá.';
    }
    $('btn-rec').addEventListener('click', () => { recording ? stopRec() : startRec(); });

    $('btn-send').onclick = async () => {
      $('rec-error').textContent = '';
      const name = $('in-name').value.trim();
      const phone = $('in-phone').value.trim();
      const consent = $('in-consent').checked;
      if (!name || !phone) { $('rec-error').textContent = 'Completá nombre y WhatsApp.'; return; }
      if (!consent) { $('rec-error').textContent = 'Tenés que aceptar las condiciones.'; return; }
      if (!audioBlob) { $('rec-error').textContent = 'Grabá tu tip primero.'; return; }
      show('v-loading');
      const fd = new FormData();
      fd.append('name', name); fd.append('phone', phone); fd.append('consent', 'true');
      fd.append('audio', audioBlob, 'tip.webm');
      try {
        const res = await fetch('/api/play', { method: 'POST', body: fd });
        const data = await res.json();
        renderResult(data);
      } catch (e) { renderResult({ status: 'error', message: 'Ups, probá de nuevo.' }); }
    };

    function renderResult(d) {
      show('v-result');
      $('res-prize').classList.add('hidden');
      if (d.status === 'won') {
        $('res-feedback').textContent = d.feedback || '¡Gracias por tu tip!';
        $('res-pct').textContent = d.discountPct;
        $('res-code').textContent = d.code;
        $('res-exp').textContent = new Date(d.expiresAt).toLocaleDateString('es-AR');
        $('res-min').textContent = d.minPurchaseArs ? `Compra mínima $${d.minPurchaseArs}.` : '';
        $('res-prize').classList.remove('hidden');
      } else if (d.status === 'cooldown') {
        $('res-feedback').textContent = `¡Ya jugaste! Podés volver a participar el ${new Date(d.nextAllowedAt).toLocaleDateString('es-AR')}.`;
      } else if (d.status === 'offtopic') {
        $('res-feedback').textContent = d.feedback || 'Contanos un tip real de entrenamiento o salud y ganás 😉';
      } else if (d.status === 'ended') {
        $('res-feedback').textContent = 'La promo terminó por ahora. ¡Gracias por participar!';
      } else {
        $('res-feedback').textContent = d.message || 'Ups, probá de nuevo en un ratito.';
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Crear `bases-y-condiciones.html`** (texto legal simple, misma estética)

```html
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Bases y Condiciones - Build</title><script src="https://cdn.tailwindcss.com"></script>
<style>body{background:#111;color:#eee;font-family:sans-serif}</style></head>
<body class="max-w-2xl mx-auto px-6 py-12 leading-relaxed">
<a href="/" class="font-black text-2xl">BUILD.</a>
<h1 class="text-3xl font-black mt-6 mb-4">Bases y Condiciones — "Contá tu tip y ganá"</h1>
<ul class="list-disc pl-5 space-y-2 text-sm text-gray-300">
  <li>Promoción de Build (La Plata). Vigencia hasta la fecha de fin de campaña informada.</li>
  <li>Un (1) cupón por número de WhatsApp cada 14 días.</li>
  <li>El cupón otorga entre 5% y 10% de descuento en suplementos y productos de dietética.</li>
  <li>Válido con compra mínima informada al momento de generar el cupón.</li>
  <li>Canje exclusivamente presencial en el mostrador de Build, mostrando el código.</li>
  <li>El cupón es de un solo uso, personal, no acumulable con otras promos y vence a los 14 días de generado.</li>
  <li>Al participar, aceptás que Build guarde tu nombre y WhatsApp para contactarte con novedades.</li>
  <li>Build puede modificar o finalizar la promoción en cualquier momento.</li>
</ul>
</body></html>
```

- [ ] **Step 3: Agregar botón de entrada en `index.html`** — insertar en el hero, junto al botón "Empezar" (buscar el bloque `<div class="flex gap-4">` del hero):

```html
<a href="/juego.html" class="bg-[#A6D60A] text-black font-black text-xl px-8 py-4 brutalist-border uppercase tracking-wider flex items-center gap-2">
  🎤 Ganá tu descuento
</a>
```

- [ ] **Step 4: Verificación manual** — con `netlify dev` (Task 13), abrir `/juego.html`, grabar un audio de prueba y confirmar el flujo completo hasta ver un cupón.

- [ ] **Step 5: Commit**

```bash
git add juego.html bases-y-condiciones.html index.html
git commit -m "feat: frontend del juego + bases y condiciones + entrada en home"
```

---

## Task 13: Panel de canje (`canje.html`) + prueba integral con `netlify dev`

**Files:**
- Create: `canje.html`

- [ ] **Step 1: Crear `canje.html`** (pide contraseña, guarda en memoria, hace lookup y mark)

```html
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Canje - Build (staff)</title><script src="https://cdn.tailwindcss.com"></script>
<style>body{background:#111;color:#fff;font-family:sans-serif}</style></head>
<body class="max-w-md mx-auto px-6 py-12">
  <h1 class="text-2xl font-black mb-6">Canje de cupones — Build</h1>
  <input id="pass" type="password" placeholder="Contraseña staff" class="w-full mb-4 px-4 py-3 rounded bg-white text-black" />
  <input id="code" placeholder="CÓDIGO (BUILD-XXXXXX)" class="w-full mb-3 px-4 py-3 rounded bg-white text-black uppercase" />
  <div class="flex gap-2">
    <button id="lookup" class="flex-1 bg-white text-black font-black py-3 rounded">Buscar</button>
    <button id="mark" class="flex-1 bg-[#A6D60A] text-black font-black py-3 rounded">Marcar usado</button>
  </div>
  <div id="out" class="mt-6 text-lg"></div>
  <a id="export" href="#" class="block mt-8 underline text-sm text-gray-400">Descargar contactos (CSV)</a>
  <script>
    const $ = (id)=>document.getElementById(id);
    const tok = ()=>$('pass').value;
    async function call(path){ const r = await fetch(path,{method:'POST',headers:{'x-staff-token':tok(),'content-type':'application/json'},body:JSON.stringify({code:$('code').value.trim().toUpperCase()})}); if(r.status===401){$('out').textContent='Contraseña incorrecta';return null;} return r.json(); }
    $('lookup').onclick = async()=>{ const d=await call('/api/redeem/lookup'); if(!d)return; $('out').innerHTML = d.found ? `<b>${d.name}</b> — ${d.discountPct}% — estado: <b>${d.status}</b> — vence ${new Date(d.expiresAt).toLocaleDateString('es-AR')}` : 'No existe ese código'; };
    $('mark').onclick = async()=>{ const d=await call('/api/redeem/mark'); if(!d)return; $('out').innerHTML = d.ok ? `✅ Marcado usado (${d.discountPct}% para ${d.name})` : `❌ ${d.reason}`; };
    $('export').onclick = async(e)=>{ e.preventDefault(); const r=await fetch('/api/export',{headers:{'x-staff-token':tok()}}); if(r.status===401){$('out').textContent='Contraseña incorrecta';return;} const b=await r.blob(); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download='contactos-build.csv'; a.click(); };
  </script>
</body></html>
```

- [ ] **Step 2: Correr toda la suite** — Run: `npm test` — Expected: todos los tests PASS.

- [ ] **Step 3: Prueba integral local** — crear `.env` con claves reales de prueba y correr `netlify dev`:

```bash
# .env (NO se commitea)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
STAFF_PASSWORD=una-clave-larga
MIN_PURCHASE_ARS=5000
CAMPAIGN_END=2999-01-01T00:00:00Z
```
Run: `npx netlify dev`
Verificar en el navegador:
1. `/juego.html`: grabar audio real → recibir cupón con % y código.
2. `/canje.html`: con la contraseña, buscar ese código (estado válido), marcarlo usado, y ver que un segundo "marcar" lo rechaza.
3. Repetir el juego con el mismo WhatsApp → mensaje de cooldown.
4. Descargar el CSV de contactos.

- [ ] **Step 4: Commit**

```bash
git add canje.html
git commit -m "feat: panel de canje para el mostrador"
```

---

## Task 14: Runbook de despliegue (para Kevin) + go-live

**Files:**
- Create: `docs/DESPLIEGUE-JUEGO.md`

- [ ] **Step 1: Escribir `docs/DESPLIEGUE-JUEGO.md`** con los pasos que hace Kevin una sola vez:

```markdown
# Poner el juego en producción (buildfit.com.ar)

1. Crear cuenta en Anthropic (console.anthropic.com), cargar saldo, generar API key.
2. Crear cuenta en OpenAI (platform.openai.com), cargar saldo, generar API key.
3. En Netlify → Site → Site configuration → Environment variables, cargar:
   - ANTHROPIC_API_KEY, OPENAI_API_KEY, STAFF_PASSWORD, MIN_PURCHASE_ARS, CAMPAIGN_END
4. Conectar este repo de GitHub a Netlify (para deploy automático) o subir con `netlify deploy --prod`.
   - Netlify detecta netlify.toml y publica el sitio + las funciones.
5. Verificar en producción: /juego.html (jugar) y /canje.html (canjear con la contraseña).
6. Compartir /juego.html en Instagram/WhatsApp para lanzar la campaña.
```

- [ ] **Step 2: Self-review de aceptación** — repasar los 7 criterios de la sección 14 del spec contra el sistema construido. Marcar los que pasan; abrir tarea por cualquiera que falle.

- [ ] **Step 3: Commit**

```bash
git add docs/DESPLIEGUE-JUEGO.md
git commit -m "docs: runbook de despliegue del juego"
```

---

## Notas de cierre

- **Deploy:** el sitio pasa de "static drag-and-drop" a "Netlify con functions". Ideal conectar GitHub para deploy automático (requiere resolver el token de push pendiente) o usar `netlify deploy --prod`.
- **Costo:** ~US$0.02–0.03 por juego; monitorear en los dashboards de Anthropic/OpenAI.
- **Fase 2 (no incluida):** envío del cupón por WhatsApp, ranking, métricas.
- **Rate-limit por IP (spec §8):** el MVP acota abuso/costo con 3 barreras ya implementadas —
  cooldown de 14 días por WhatsApp, rechazo de audios off-topic/ruido (no generan cupón), y
  fecha de fin de campaña. El límite adicional por IP se deja como endurecimiento posterior
  (fácil de sumar en `handlePlay` leyendo `context.ip` + un contador en Blobs por hora); no es
  bloqueante para lanzar.
- **Límite de audio:** se enforce en el front (corte automático a 60s en `juego.html`).

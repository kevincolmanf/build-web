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

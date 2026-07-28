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

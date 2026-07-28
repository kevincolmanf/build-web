# Diseño — Juego con IA "Contá tu tip y ganá" (Build)

Fecha: 2026-07-28
Estado: aprobado el diseño conceptual; pendiente revisión del spec escrito.

## 1. Objetivo

Sumar a `buildfit.com.ar` un mini-juego: la persona graba un **audio** contando un tip
sobre entrenamiento / salud / kinesiología, la **IA** le da una devolución personalizada y
le entrega un **cupón de descuento (5–10%)** para suplementos y dietética, válido **14 días**.
Doble objetivo: enganche/consumo del público y **captación de contactos** (leads) para Build.

## 2. Alcance

**MVP (este spec):**
- Landing/sección del juego dentro del sitio actual.
- Captura de Nombre + WhatsApp con consentimiento.
- Grabación de audio en el navegador (móvil y desktop).
- Transcripción (Whisper) + evaluación (Claude) → devolución + % ganado.
- Generación de cupón único, de un solo uso, con vencimiento a 14 días.
- Anti-abuso: 1 cupón por número de WhatsApp cada 14 días.
- Panel de canje para el mostrador (validar / marcar usado), protegido con contraseña.
- Lista de contactos y cupones exportable (CSV).
- Campaña con **fecha de fin** configurable.

**Fuera de alcance (Fase 2):**
- Envío automático del cupón por WhatsApp.
- Ranking / leaderboard, estadísticas avanzadas, panel de métricas.
- Integración con tienda online (el canje es **físico** en el mostrador).
- Login de usuarios / cuentas.

## 3. Experiencia de usuario (flujo)

1. **Entrada:** botón "Ganá tu descuento" en la home → ruta `/juego`.
2. **Bienvenida:** reglas cortas + botón "Empezar". Muestra vigencia de la campaña.
3. **Datos:** Nombre + WhatsApp + checkbox de consentimiento (link a Bases y Condiciones).
4. **Grabación:** botón grande de micrófono; graba hasta 60 s; permite escuchar y re-grabar.
5. **Procesando:** animación "Analizando tu tip…" mientras corre transcripción + IA.
6. **Resultado:**
   - Devolución personalizada y positiva de la IA sobre lo que dijo.
   - **% ganado** (5–10) destacado.
   - **Código de cupón** + fecha de vencimiento + condición de compra mínima.
   - CTA "Mostralo en el mostrador de Build".
7. **Caso ya jugó:** si el WhatsApp ya generó cupón en los últimos 14 días → mensaje amable
   con la fecha en que podrá volver a jugar (no genera cupón nuevo).
8. **Caso off-topic/vacío:** la IA pide amablemente un tip real; no entrega cupón.

Estética: sigue el sistema visual del sitio (negro/blanco + verde ácido #A6D60A, tipografía
Montserrat, estilo plano tipo sticker). Los mockups visuales se definen antes de implementar.

## 4. Lógica de la IA

**Pipeline:** audio (blob) → transcripción (Whisper) → evaluación (Claude) → resultado.

**Evaluación (Claude):** recibe la transcripción y devuelve un JSON estructurado con:
- `onTopic` (bool): ¿es sobre entrenamiento/salud/kinesiología/nutrición?
- `score` (0–100): claridad, detalle, aporte real.
- `feedback` (texto): devolución breve, positiva, en tono Build (tuteo, canchero pero serio).
- `flags`: contenido peligroso/ofensivo/spam.

**Mapeo score → % (escalonado, "todos ganan"):**
- No on-topic o `flags` de spam/abuso → **sin cupón** (mensaje pidiendo un tip real).
- On-topic: `%` interpolado de 5 a 10 según `score` (redondeado a entero).
  Referencia: 0–20→5, 21–40→6, 41–60→7, 61–80→8, 81–95→9, 96–100→10.

**Seguridad de contenido:** si el tip incluye un consejo potencialmente riesgoso (ej. dosis,
lesiones), la IA **no lo valida como verdad**; redirige suave ("mejor consultalo con el equipo
de Build") y de todas formas puede entregar cupón si el intento es genuino y on-topic.

**Claves:** todas las llamadas a Whisper y Claude ocurren **server-side** (Netlify Functions).
Las API keys viven en variables de entorno de Netlify; nunca se exponen en el navegador.

## 5. Modelo de datos (Netlify Blobs)

Store key-value. Tres "colecciones" lógicas:

**`coupons/<code>`**
```
{
  code: "BUILD-XXXX",          // único, legible
  discountPct: 7,
  name: "Kevin",
  phone: "+549221...",          // normalizado E.164
  status: "valid" | "redeemed" | "expired",
  createdAt: ISO,
  expiresAt: ISO,               // createdAt + 14 días
  redeemedAt: ISO | null,
  transcriptExcerpt: "…",       // primeras palabras, para contexto del staff
  score: 72
}
```

**`phones/<phoneHash>`** (rate-limit anti-abuso)
```
{ lastCouponAt: ISO, lastCode: "BUILD-XXXX" }
```
`phoneHash` = hash del teléfono normalizado (no guardar en claro como key).

**`leads/<id>`** (contactos para remarketing; exportable a CSV)
```
{ name, phone, createdAt, consent: true, couponCode, score }
```

## 6. Arquitectura técnica

- **Frontend:** páginas nuevas dentro del sitio estático actual (`/juego`, y panel `/canje`).
  Grabación con `MediaRecorder` API. Sin framework nuevo; se mantiene el stack actual
  (HTML + Tailwind CDN).
- **Backend:** **Netlify Functions** (serverless). El sitio pasa a ser "Netlify site con
  functions" (mismo hosting, se agrega carpeta `netlify/functions/` y `netlify.toml`).
- **Transcripción:** OpenAI Whisper API (`whisper-1`), ~US$0.006/min.
- **IA:** Anthropic Claude (modelo económico y capaz, ej. Claude Haiku para costo, o Sonnet
  para mejor devolución — a definir en implementación según calidad/costo).
- **Persistencia:** Netlify Blobs (incluido, sin DB externa).
- **Config:** variables de entorno en Netlify (API keys, contraseña del panel, parámetros de
  campaña).

## 7. Endpoints (Netlify Functions)

- `POST /api/play`
  Entrada: `{ name, phone, consent, audio (multipart/base64) }`.
  Pasos: valida datos → chequea rate-limit por teléfono → transcribe → evalúa con Claude →
  si corresponde, genera cupón, persiste (coupon + phone + lead) → responde
  `{ feedback, discountPct?, code?, expiresAt?, alreadyPlayed?, offTopic? }`.
- `POST /api/redeem/lookup` (staff): `{ code }` → `{ name, discountPct, status, expiresAt }`.
- `POST /api/redeem/mark` (staff): `{ code }` → marca `redeemed` (idempotente; falla si ya
  usado/vencido).
- `GET /api/export` (staff): descarga CSV de leads/cupones.
  Todos los endpoints de staff requieren la contraseña del panel (header/token simple).

## 8. Anti-abuso y límites

- **1 cupón por teléfono cada 14 días** (chequeo en `phones/<hash>`).
- Límite de duración del audio (60 s) y tamaño máximo del archivo.
- Rate-limit básico por IP (por defecto 10 intentos / hora, configurable) para evitar flood.
- Validación de formato de teléfono (Argentina) y normalización E.164.
- La IA descarta audios vacíos/ruido/off-topic (no entregan cupón).
- **Fecha de fin de campaña:** pasada la fecha, `/api/play` responde "campaña finalizada".

## 9. Panel de canje (mostrador)

- Ruta `/canje`, protegida con **contraseña** (config en Netlify).
- Input de código → muestra nombre, %, estado (válido / vencido / ya usado), vencimiento.
- Botón "Marcar como usado" (idempotente).
- Link para **exportar CSV** de contactos y cupones.

## 10. Parámetros configurables (env / config)

- `CAMPAIGN_END` (fecha de fin).
- `MIN_PURCHASE_ARS` (monto mínimo de compra; Kevin lo define al lanzar; se muestra en el
  cupón y en las bases).
- `COUPON_TTL_DAYS` = 14.
- `MAX_AUDIO_SECONDS` = 60.
- `STAFF_PASSWORD`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

## 11. Privacidad y legales

- Checkbox de **consentimiento** obligatorio antes de jugar (guardar tips/contacto y recibir
  comunicaciones de Build).
- Página breve de **Bases y Condiciones** (vigencia, 1 cupón por persona/14 días, compra
  mínima, canje solo en mostrador, no acumulable, Build puede finalizar la promo).
- No se publica ni comparte el audio; se guarda solo un extracto de texto para el staff.
- Datos personales tratados solo para la promo y remarketing de Build.

## 12. Costos estimados

- Por juego: Whisper (~US$0.003–0.006) + Claude (~US$0.01–0.02) ≈ **US$0.02–0.03**.
- 1.000 juegos ≈ US$20–30. Netlify Functions + Blobs: gratis para este volumen.

## 13. Manejo de errores

- Sin permiso de micrófono → instrucción clara para habilitarlo.
- Navegador sin `MediaRecorder` → fallback (subir audio) o mensaje.
- Falla de transcripción/IA → reintento; si persiste, mensaje amable "probá de nuevo",
  sin descontar el intento (no marca rate-limit si no se generó cupón).
- Audio muy largo/pesado → aviso antes de enviar.
- Teléfono inválido → validación en el formulario.
- Timeouts de function → límites de tiempo controlados; respuesta de error clara.

## 14. Criterios de aceptación

1. Un usuario nuevo completa el flujo en móvil y recibe un cupón con % (5–10), código y
   vencimiento a 14 días.
2. El mismo teléfono, dentro de 14 días, no obtiene un segundo cupón (mensaje correcto).
3. Un audio off-topic/ruido no genera cupón y muestra el mensaje adecuado.
4. En el panel de canje, un código válido se puede ver y marcar como usado; un código ya
   usado o vencido se rechaza.
5. Las API keys no aparecen en el frontend (verificado en el bundle/red).
6. Pasada la fecha de campaña, no se generan cupones nuevos.
7. El CSV de contactos se descarga con los leads capturados.

## 15. Fase 2 (futuro)

- Envío del cupón por WhatsApp automático.
- Ranking/leaderboard y estadísticas.
- Variantes de campaña (temáticas, % especiales por fecha).
- Tienda online + canje online.

## 16. Riesgos / decisiones abiertas

- **Modelo de Claude** (Haiku vs Sonnet): definir en implementación según calidad de la
  devolución vs costo.
- **Setup de cuentas** Anthropic + OpenAI con tarjeta (a cargo de Kevin; guiado).
- Confiabilidad de grabación en algunos navegadores móviles (mitigado con fallback de subida).
- Monto mínimo de compra: parámetro a definir por Kevin al lanzar.

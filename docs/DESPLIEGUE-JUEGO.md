# Poner el juego en producción (buildfit.com.ar)

1. Crear cuenta en Anthropic (console.anthropic.com), cargar saldo, generar API key.
2. Crear cuenta en OpenAI (platform.openai.com), cargar saldo, generar API key.
3. En Netlify → Site → Site configuration → Environment variables, cargar:
   - ANTHROPIC_API_KEY, OPENAI_API_KEY, STAFF_PASSWORD, MIN_PURCHASE_ARS, CAMPAIGN_END
4. Conectar este repo de GitHub a Netlify (para deploy automático) o subir con `netlify deploy --prod`.
   - Netlify detecta netlify.toml y publica el sitio + las funciones.
5. Verificar en producción: /juego.html (jugar) y /canje.html (canjear con la contraseña).
6. Compartir /juego.html en Instagram/WhatsApp para lanzar la campaña.

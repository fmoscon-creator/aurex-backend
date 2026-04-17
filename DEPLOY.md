# AUREX Backend — Deploy

## Arquitectura

```
Repo: fmoscon-creator/aurex-backend
Hosting: Railway (proyecto lavish-ambition, servicio aurex-app)
Runtime: Node.js 20 (forzado via nixpacks.toml)
URL: https://aurex-app-production.up.railway.app
```

## Cómo se deploya

1. Push a `main` en este repo
2. Railway detecta el push via webhook de GitHub
3. Nixpacks buildea con Node.js (lee `nixpacks.toml`)
4. Ejecuta `node server.js`
5. El servidor arranca en el PORT que Railway asigna

**NO usar `railway up` desde CLI.** Eso sube archivos locales sin pasar por Nixpacks correctamente. Siempre deployar via push a GitHub.

## Archivos clave

| Archivo | Función |
|---------|---------|
| `server.js` | Servidor Express principal (API, cron, motor IA) |
| `package.json` | Dependencias Node.js |
| `nixpacks.toml` | Fuerza Node.js 20 como runtime (NO eliminar) |
| `railway.json` | Config Railway: startCommand + restartPolicy |
| `Procfile` | Alternativa: `web: node server.js` |
| `activos.json` | Lista de 350+ activos globales |

## Variables de entorno (Railway)

Configuradas en Railway dashboard (NO en .env):
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — Base de datos
- `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` — WhatsApp
- `ADMIN_WHATSAPP` — Teléfono admin (Fernando)
- `ANTHROPIC_API_KEY` — Claude API
- `ALPHA_VANTAGE_KEY` — Datos financieros
- `TELEGRAM_BOT_TOKEN` — Bot Telegram
- `LEMONSQUEEZY_WEBHOOK_SECRET` — Pagos
- `NIXPACKS_NO_CACHE` — Fuerza rebuild limpio (dejar en 1)

## Relación con otros repos

| Repo | Qué es | Deploy |
|------|--------|--------|
| `aurex-backend` (este) | Backend Node.js API | Railway auto-deploy |
| `aurex-app` | PWA (HTML+JS) | GitHub Pages → aurex.live |
| `AurexApp` | App nativa iOS | Xcode → App Store |

## Rollback

Si algo se rompe, revertir el último commit y pushear:
```bash
git revert HEAD && git push
```
Railway redeploya automáticamente con la versión anterior.

## REGLAS

1. **NUNCA** usar `railway up` desde CLI
2. **NUNCA** eliminar `nixpacks.toml`
3. **SIEMPRE** deployar via push a `main`
4. **SIEMPRE** verificar que Railway muestre "SUCCESS" después del push
5. El backend de producción es ESTE repo, no `/backend` de `aurex-app`

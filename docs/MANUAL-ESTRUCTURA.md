# MANUAL DE ESTRUCTURA — AUREX
v1.0 — 21 abril 2026

---

## REPOSITORIOS

| Repo | URL | Branch | Safety Point | Deploy |
|------|-----|--------|-------------|--------|
| aurex-backend | github.com/fmoscon-creator/aurex-backend | main | `03a6892` | Railway auto-deploy |
| aurex-app (PWA) | github.com/fmoscon-creator/aurex-app | main | `e314c13` | GitHub Pages auto |
| AurexApp (Nativa) | github.com/fmoscon-creator/AurexApp | dev | `7874f0f` | Xcode → TestFlight |

**Build Nativa:** Build 12 en TestFlight (10/04/2026, NO incluye fallback). Build 14 pendiente con fallback.

---

## BACKEND — server.js (1477+ líneas)

### Funciones principales

| Función | Línea aprox | Cron | Qué hace |
|---------|-------------|------|----------|
| `fetchCryptoPriceBatch(symbols)` | L153 | — | Cadena: Binance→CC→Kraken→CoinGecko→Cache. Escribe en `cryptoCache` |
| `refreshCryptoCache()` | L351-357 | `*/2 * * * *` + boot 5s | Llama fetchCryptoPriceBatch con 53 crypto/stable |
| `checkAlertas()` | L305 | `*/30 * * * * *` | Chequea alertas de usuario, usa fetchCryptoPriceBatch para crypto |
| `calcularSenalesIA()` | ~L700 | `*/5 * * * *` | Motor IA 350 activos. Yahoo → CC fallback para crypto |
| `calcularPulse()` | ~L810 | `*/5 * * * *` | AUREX Pulse. Binance (BTC/ETH) + Yahoo (resto) |
| `healthCheck()` | ~L680 | `*/5 * * * *` | Monitorea Evolution, Supabase, Binance |
| `dailyHealthReport()` | ~L1200 | `0 11 * * *` (08:00 AR) | Reporte diario WhatsApp + Supabase |
| `monthlyHealthReport()` | ~L1292 | Último día hábil | Reporte mensual |
| `_buildAndSendMonthlyReport()` | ~L1330 | — | Construye y envía el mensual |
| `restoreHealthState()` | ~L900 | boot | Restaura flags de health desde Supabase |
| `_ccLoadCounter()` | L112 | boot 3s | Lee contador CC de Supabase |
| `_ccIncrement(n)` | L129 | — | Incrementa contador, persiste cada 50, alertas 80k/95k |
| `_fetchCryptoCompareIA(sym)` | ~L595 | — | Fallback CC para motor IA (2 calls: precio + historial) |
| `_fetchYahooIA(sym)` | ~L615 | — | Yahoo para motor IA |
| `_fetchBinanceIA(sym)` | ~L580 | — | Binance para motor IA |

### Endpoint `/api/crypto-prices`

- URL: `GET https://aurex-app-production.up.railway.app/api/crypto-prices`
- Respuesta: `{ ok: true, source: "cryptocompare", count: 53, prices: { BTC: {price, source, ts}, ... } }`
- Se llena via `refreshCryptoCache` cada 2 min
- Sirve como fallback para PWA y Nativa cuando Binance falla

---

## TABLAS SUPABASE

| Tabla | Uso |
|-------|-----|
| alertas | Alertas de precio de usuario |
| alertas_historial | Historial de alertas disparadas |
| health_events | Incidentes de salud (BN-001, BN-002, etc.) |
| daily_reports | Reportes diarios persistidos |
| monthly_reports | Reportes mensuales persistidos |
| system_config | Configuración sistema (cc_monthly_calls) — creada 21/04/2026 |
| usuarios | Datos de usuarios |
| portfolio | Portfolio de usuarios |
| watchlists | Listas watchlist |
| watchlist_items | Items dentro de watchlists |

---

## VARIABLES DE ENTORNO RAILWAY

| Variable | Uso |
|----------|-----|
| CRYPTOCOMPARE_KEY | API key CryptoCompare (configurada 21/04/2026) |
| ADMIN_WHATSAPP | Número admin para alertas WhatsApp |
| EVOLUTION_API_URL | URL de Evolution API |
| EVOLUTION_API_KEY | Key de Evolution API |
| EVOLUTION_INSTANCE | Nombre instancia Evolution (default: aurex) |
| SUPABASE_URL | URL de Supabase |
| SUPABASE_SERVICE_KEY | Service key de Supabase |
| TELEGRAM_BOT_TOKEN | Token bot Telegram |
| TWILIO_ACCOUNT_SID | SID cuenta Twilio |
| TWILIO_AUTH_TOKEN | Token Twilio |
| TWILIO_WHATSAPP_FROM | Número WhatsApp Twilio |
| ALPHA_KEY | API key Alpha Vantage |
| ANTHROPIC_API_KEY | API key Claude (análisis alertas) |

---

## FALLBACK PWA (aurex-features.js, commit e314c13)

En el catch vacío de fetchBinance (~L394):
- Fetch a `/api/crypto-prices`
- Actualiza DOM `p-{sym}` y `c-{sym}` con `_fmt`
- Persiste en `window._pcPrices[sym]`

## FALLBACK NATIVA (commit 7874f0f, branch dev)

| Screen | Archivo | Lógica |
|--------|---------|--------|
| IAScreen | L136-159 | catch → fetch `/api/crypto-prices` → `setPrices(d.prices)` |
| MercadosScreen | L359-370 | catch → fetch `/api/crypto-prices` → `setPrices` |
| PortfolioScreen | L125-133 | Detecta `missing`, solo pide backend si hay faltantes, llena `allPrices[s]`, catch con log |

---

## SAFETY POINTS

| Fecha | PWA | Nativa | Backend |
|-------|-----|--------|---------|
| 21/04/2026 | `e314c13` (main) | `7874f0f` (dev) | `03a6892` (main) |
| 15/04/2026 | `5505c41` (main) | `72ac92b` (dev) | — |

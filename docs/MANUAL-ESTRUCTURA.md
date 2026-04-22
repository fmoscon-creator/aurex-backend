# MANUAL DE ESTRUCTURA — AUREX
v2.1 — 21 abril 2026

---

## REPOSITORIOS

| Repo | URL | Branch | Safety Point | Deploy |
|------|-----|--------|-------------|--------|
| aurex-backend | github.com/fmoscon-creator/aurex-backend | main | `c27217d` | Railway auto-deploy |
| aurex-app (PWA) | github.com/fmoscon-creator/aurex-app | main | `4fb7421` | GitHub Pages auto |
| AurexApp (Nativa) | github.com/fmoscon-creator/AurexApp | dev | `1359dbd` | Xcode → TestFlight |

**Builds Nativa:**
- Build 9: en App Store Review (enviada 9/abril, pendiente)
- Build 14: en TestFlight (fallback crypto `/api/crypto-prices`)
- Build 15: en proceso (todos los fallbacks + cache AsyncStorage + Clearbit logos)

---

## NATIVA — FALLBACKS IMPLEMENTADOS (Build 15)

| # | Qué protege | Fallback | Commit | Archivos |
|---|-------------|----------|--------|----------|
| 1 | Precios crypto (53 activos) | Backend `/api/crypto-prices` | `7874f0f` | IAScreen, MercadosScreen, PortfolioScreen |
| 2 | Precios stocks/ETFs/bonos/commodities/metales/divisas (297 activos) | Yahoo directo desde celular | `a4c2675` | MercadosScreen (2), WatchlistScreen (2), PortfolioScreen (2) |
| 3 | Señales IA + Pulse | AsyncStorage cache | `b4cb34e` | IAScreen, MercadosScreen (Pulse + IA signals) |
| 4 | Portfolio + Watchlist datos | AsyncStorage cache | `30952f2` | PortfolioScreen, WatchlistScreen |
| 5 | Logos acciones/ETFs | Clearbit (30 dominios) | `a1d1100` | AssetLogo.js |

### Keys AsyncStorage (7 total)

| Key | Qué guarda | Screen |
|-----|-----------|--------|
| aurex_ia_cache | { signals, prices, ts } | IAScreen |
| aurex_pulse_cache | { data, ts } | MercadosScreen |
| aurex_ia_signals_map | { simbolo: signal } | MercadosScreen |
| aurex_wl_ia_cache | { simbolo: signal } | WatchlistScreen |
| aurex_port_ia_cache | { simbolo: signal } | PortfolioScreen |
| aurex_port_data | [ portfolio items ] | PortfolioScreen |
| aurex_wl_data | { lists, items } | WatchlistScreen |

---

## BACKEND — server.js (~1490 líneas)

### Funciones principales

| Función | Cron | Qué hace |
|---------|------|----------|
| `fetchCryptoPriceBatch(symbols)` | — | Cadena: Binance→CC→Kraken→CoinGecko→Cache |
| `refreshCryptoCache()` | `*/2 * * * *` + boot 5s | Llena cryptoCache con 53 crypto/stable |
| `checkAlertas()` | `*/30 * * * * *` | Alertas de usuario, usa fetchCryptoPriceBatch |
| `calcularSenalesIA()` | `*/5 * * * *` | Motor IA 350 activos. Yahoo → CC fallback |
| `calcularPulse()` | `*/5 * * * *` | Pulse. Binance → CC fallback para BTC/ETH |
| `healthCheck()` | `*/5 * * * *` | Monitorea Evolution, Supabase, Binance |
| `dailyHealthReport()` | `0 11 * * *` (08:00 AR) | Reporte + CC counter |
| `monthlyHealthReport()` | Último día hábil | Reporte mensual (incluye Kraken) |
| `restoreHealthState()` | boot | Restaura flags health |
| `_ccLoadCounter()` | boot 3s | Lee contador CC de Supabase |
| `_ccIncrement(n)` | — | Incrementa + persiste + alertas 80k/95k |

### Endpoint `/api/crypto-prices`

- URL: `GET https://aurex-app-production.up.railway.app/api/crypto-prices`
- Respuesta: `{ ok: true, source: "cryptocompare", count: 53, prices: {...} }`
- Actualización: cada 2 min via refreshCryptoCache
- Sirve como fallback para PWA y Nativa

---

## TABLAS SUPABASE

| Tabla | Uso |
|-------|-----|
| alertas | Alertas de precio de usuario |
| alertas_historial | Historial de alertas disparadas |
| health_events | Incidentes de salud |
| daily_reports | Reportes diarios |
| monthly_reports | Reportes mensuales |
| system_config | cc_monthly_calls (creada 21/04/2026) |
| usuarios | Datos de usuarios |
| portfolio | Portfolio de usuarios |
| watchlists | Listas watchlist |
| watchlist_items | Items de watchlists |

---

## VARIABLES DE ENTORNO RAILWAY

| Variable | Uso |
|----------|-----|
| CRYPTOCOMPARE_KEY | API key CryptoCompare (21/04/2026) |
| ADMIN_WHATSAPP | Número admin alertas |
| EVOLUTION_API_URL | URL Evolution API |
| EVOLUTION_API_KEY | Key Evolution |
| EVOLUTION_INSTANCE | Instancia (aurex) |
| SUPABASE_URL | URL Supabase |
| SUPABASE_SERVICE_KEY | Service key |
| TELEGRAM_BOT_TOKEN | Bot Telegram |
| TWILIO_ACCOUNT_SID | Twilio SID |
| TWILIO_AUTH_TOKEN | Twilio token |
| TWILIO_WHATSAPP_FROM | WhatsApp Twilio |
| ALPHA_KEY | Alpha Vantage key |
| ANTHROPIC_API_KEY | Claude (análisis alertas) |

---

## PWA — FALLBACKS IMPLEMENTADOS (commit 4fb7421)

| # | Qué protege | Fallback | Catches |
|---|-------------|----------|---------|
| G1 | Precios crypto (5 catches) | Backend `/api/crypto-prices` | Mercados individual, Watchlist precio, Watchlist histórico, Watchlist comparador, Portfolio batch |
| G2 | Precios stocks (5 catches) | Yahoo directo `query1.finance.yahoo.com` | Mercados principal, Watchlist precio, Watchlist histórico, Watchlist comparador, Portfolio batch |
| G3 | Señales IA | localStorage `aurex_ia_pwa_cache` + `_iaLoadFromCache()` | Éxito → setItem, 3 reintentos fallidos → getItem |
| G4 | Portfolio datos | localStorage `aurex_port_items_cache` | Catch Supabase → lee cache antes de mostrar vacío |
| G4 | Watchlist datos | localStorage `aurex_wl_pwa_cache` | Sync éxito → setItem, Sync fallo → getItem |

### Keys localStorage PWA (3 total)

| Key | Qué guarda | Escribe | Lee (fallback) |
|-----|-----------|---------|----------------|
| aurex_ia_pwa_cache | { signals, ts } | generarSenalesIA éxito | _iaLoadFromCache tras 3 fallos |
| aurex_wl_pwa_cache | { lists, items } | _wlSyncFromSupabase éxito | _wlSyncFromSupabase fallo |
| aurex_port_items_cache | [ portfolio items ] | (ya existía) | _fetchPortfolio fallo |

---

## CADENAS COMPLETAS POR DATO

### Precios crypto (nativa)
Binance directo (celular) → si falla → Backend `/api/crypto-prices` (CC→Kraken→CoinGecko→Cache)

### Precios crypto (PWA)
Binance directo (browser) → si falla → Backend `/api/crypto-prices` (CC→Kraken→CoinGecko→Cache)

### Precios stocks/ETFs/bonos/etc (nativa)
Yahoo via Railway proxy → si falla → Yahoo directo desde celular → si falla → sin precio

### Precios stocks/ETFs/bonos/etc (PWA)
Yahoo via Railway proxy → si falla → Yahoo directo desde browser → si falla → sin precio

### Señales IA (nativa)
Backend `/api/ia-signals` → si falla → AsyncStorage cache → si falla → cálculo local

### Señales IA (PWA)
Backend `/api/ia-signals` → si falla (3 reintentos) → localStorage cache → si falla → sin señales

### Pulse (nativa)
Backend `/api/pulse` → si falla → AsyncStorage cache → si falla → cálculo local

### Portfolio datos (nativa)
Backend `/api/portfolio` → si falla → AsyncStorage cache → si falla → vacío

### Portfolio datos (PWA)
Supabase directo → si falla → localStorage cache → si falla → vacío

### Watchlist datos (nativa)
Backend `/api/watchlists` → si falla → AsyncStorage cache → si falla → vacío

### Watchlist datos (PWA)
Supabase directo → si falla → localStorage cache → si falla → vacío

### Logos crypto (nativa)
assets.js URL → CoinCap → si falla → círculo con iniciales

### Logos acciones (nativa)
assets.js URL → FMP → si falla → Clearbit (30 dominios) → si falla → círculo con iniciales

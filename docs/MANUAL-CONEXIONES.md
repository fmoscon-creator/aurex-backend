# MANUAL DE CONEXIONES — AUREX
v1.0 — 21 abril 2026

---

## CADENA DE FALLBACK BACKEND (fetchCryptoPriceBatch)

```
Binance (L160-175) → CryptoCompare (L177-197) → Kraken (L199-230) → CoinGecko (L232-250) → Cache stale (L252-267)
```

Cada paso tiene timeout de 5 segundos. Si un paso responde OK → return inmediato, no prueba el siguiente.

---

## FUENTES DE DATOS

### Fuente 1 — Binance
- **URL:** `https://api.binance.com/api/v3/ticker/price`
- **API key:** NO requiere
- **Estado:** FALLA en Railway desde 18/04/2026 (bloqueo IP). Alerta BN-002 activa.
- **Escribe en:** `cryptoCache[sym]` L170
- **Funciona desde:** browser del usuario (PWA y Nativa)

### Fuente 2 — CryptoCompare
- **URL:** `https://min-api.cryptocompare.com/data/pricemulti`
- **API key:** Sí, via header `authorization: Apikey ${CRYPTOCOMPARE_KEY}`. Env var en Railway configurada 21/04/2026.
- **Límite:** 100.000 calls/mes (plan gratuito con key)
- **Contador:** Persistido en Supabase `system_config` key `cc_monthly_calls`
- **Alertas límite:** 80k (80%) y 95k (95%) por WhatsApp, una vez por mes
- **Reset:** Día 1 cada mes 00:00 AR (cron `0 3 1 * *`)
- **Escribe en:** `cryptoCache[sym]` L189
- **Estado:** ACTIVA como fuente primaria desde 18/04/2026

### Fuente 3 — Kraken
- **URL:** `https://api.kraken.com/0/public/Ticker`
- **API key:** NO requiere
- **Mapeo tickers:**
  - BTC → XXBTZUSD
  - ETH → XETHZUSD
  - XRP → XXRPZUSD
  - LTC → XLTCZUSD
  - DOGE → XDGUSD
  - Resto → SIMBOLOUSD
- **Sin cobertura (4):** FTM, MKR, ROSE, THETA → saltan a CoinGecko
- **Escribe en:** `cryptoCache[sym]` directamente
- **Estado:** Fallback 2, activa solo si CC falla

### Fuente 4 — CoinGecko
- **URL:** `https://api.coingecko.com/api/v3/simple/price`
- **API key:** NO requiere
- **Límite:** ~10.000 calls/mes (plan gratuito)
- **Mapeo:** Usa `COINGECKO_IDS` (L85-102 server.js)
- **Estado:** Fallback 3, activa solo si CC y Kraken fallan

### Fuente 5 — Yahoo Finance
- **URL:** `https://query1.finance.yahoo.com/v8/finance/chart/`
- **Proxy:** Via Railway `GET /api/yahoo?symbol=X`
- **API key:** NO requiere
- **Uso:** Stocks, ETFs, Bonos, Commodities, Metales, Divisas, Materias Primas + Motor IA todos los activos

### Fuente 6 — Alpha Vantage
- **URL:** `https://www.alphavantage.co/query`
- **API key:** Sí, env var `ALPHA_KEY` en Railway
- **Límite:** 25 calls/min
- **Uso:** Precios acciones en `checkAlertas` (backend)

### Cache de emergencia
- **TTL:** 30 minutos (`CRYPTO_CACHE_EMERGENCY_TTL = 1800000`)
- **Cuándo:** Solo si las 4 fuentes anteriores fallan
- **Marca:** `source: 'cache', stale: true`

---

## CADENA PWA

```
Binance directo (browser del usuario)
  ↓ si falla (catch)
fetch /api/crypto-prices (Railway backend)
  ↓ responde con datos de CC/Kraken/CoinGecko/Cache
Actualiza DOM + window._pcPrices
```

Archivo: aurex-features.js, commit e314c13

## CADENA NATIVA

```
Binance directo (celular del usuario)
  ↓ si falla (catch)
fetch /api/crypto-prices (Railway backend)
  ↓ responde con datos de CC/Kraken/CoinGecko/Cache
setPrices() con los precios del backend
```

Archivos (commit 7874f0f, branch dev):
- IAScreen.js L136-159
- MercadosScreen.js L359-370
- PortfolioScreen.js L125-133 (solo pide missing)

---

## ENDPOINT `/api/crypto-prices`

- **URL:** `https://aurex-app-production.up.railway.app/api/crypto-prices`
- **Método:** GET
- **Respuesta:** `{ ok: true, source: "cryptocompare", count: 53, prices: { BTC: { price: 75870, source: "cryptocompare", ts: 1713... }, ... } }`
- **Actualización:** Cada 2 min via `refreshCryptoCache` (cron `*/2 * * * *`) + al boot (5s)
- **Sirve a:** PWA y Nativa como fallback cuando Binance falla desde el dispositivo

---

## ESTADO ACTUAL (21/04/2026)

| Fuente | Backend Railway | PWA (browser) | Nativa (celular) |
|--------|----------------|---------------|-----------------|
| Binance | ❌ Bloqueado | ✅ Funciona | ✅ Funciona |
| CryptoCompare | ✅ Activa (con key) | — | — |
| Kraken | ✅ Disponible | — | — |
| CoinGecko | ✅ Disponible | — | — |
| Yahoo | ✅ Funciona | ✅ Via proxy | ✅ Via proxy |
| Alpha Vantage | ✅ Funciona | — | — |
| /api/crypto-prices | ✅ count:53 | ✅ Fallback | ✅ Fallback (build 14) |

---

## CONSUMO ESTIMADO CRYPTOCOMPARE (Binance caído)

| Origen | Frecuencia | Calls/día | Calls/mes |
|--------|-----------|-----------|-----------|
| refreshCryptoCache | cada 2 min | 720 | 21.600 |
| checkAlertas (si hay alertas) | cada 30 seg | 2.880 | 86.400 |
| Motor IA (fallback Yahoo) | variable | ~50-500 | ~1.500-15.000 |
| **Total estimado** | — | ~3.650-4.100 | **~109.500-123.000** |

⚠️ Puede superar el límite de 100k/mes. Monitorear con el contador + alertas.

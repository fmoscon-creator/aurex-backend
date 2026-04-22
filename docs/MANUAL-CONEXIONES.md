# MANUAL DE CONEXIONES — AUREX
v2.1 — 21 abril 2026

---

## CADENA DE FALLBACK BACKEND (fetchCryptoPriceBatch)

```
Binance → CryptoCompare (con API key) → Kraken → CoinGecko → Cache stale 30min
```

## CADENA NATIVA (Build 15)

### Precios crypto
```
Binance directo (celular) → /api/crypto-prices (backend: CC→Kraken→CoinGecko→Cache)
```

### Precios stocks/ETFs/bonos/commodities/metales/divisas/mat.primas (297 activos)
```
Yahoo via Railway proxy → Yahoo directo desde celular (sin proxy)
```

### Señales IA
```
Backend /api/ia-signals → AsyncStorage cache local → cálculo local
```

### Pulse
```
Backend /api/pulse → AsyncStorage cache local → cálculo local
```

### Portfolio datos
```
Backend /api/portfolio → AsyncStorage cache local
```

### Watchlist datos
```
Backend /api/watchlists → AsyncStorage cache local
```

### Logos crypto
```
assets.js URL fija → CoinCap → círculo con iniciales
```

### Logos acciones/ETFs
```
assets.js URL fija → FMP → Clearbit (30 dominios) → círculo con iniciales
```

## CADENA PWA (commit 4fb7421)

### Precios crypto (5 catches)
```
Binance directo (browser) → /api/crypto-prices (backend: CC→Kraken→CoinGecko→Cache)
```

### Precios stocks/ETFs/etc (5 catches)
```
Yahoo via Railway proxy → Yahoo directo desde browser (sin proxy)
```

### Señales IA
```
Backend /api/ia-signals → 3 reintentos → localStorage aurex_ia_pwa_cache → sin señales
```

### Portfolio datos
```
Supabase directo → localStorage aurex_port_items_cache → vacío
```

### Watchlist datos
```
Supabase directo → localStorage aurex_wl_pwa_cache → vacío
```

---

## FUENTES DE DATOS

### Fuente 1 — Binance
- URL: `api.binance.com/api/v3/ticker/price`
- API key: NO
- Estado: FALLA en Railway desde 18/04/2026. Funciona desde celular/browser.
- Escribe en: `cryptoCache[sym]`

### Fuente 2 — CryptoCompare
- URL: `min-api.cryptocompare.com/data/pricemulti`
- API key: Sí, header `authorization: Apikey ${CRYPTOCOMPARE_KEY}`
- Límite: 100k calls/mes con key
- Contador: Supabase `system_config`, alertas 80k/95k
- Estado: ACTIVA como primaria desde 18/04/2026

### Fuente 3 — Kraken
- URL: `api.kraken.com/0/public/Ticker`
- API key: NO
- Mapeo: BTC→XXBTZUSD, ETH→XETHZUSD, XRP→XXRPZUSD, LTC→XLTCZUSD, DOGE→XDGUSD
- Sin cobertura: FTM, MKR, ROSE, THETA → saltan a CoinGecko

### Fuente 4 — CoinGecko
- URL: `api.coingecko.com/api/v3/simple/price`
- API key: NO
- Límite: ~10k calls/mes

### Fuente 5 — Yahoo Finance
- URL: `query1.finance.yahoo.com/v8/finance/chart/`
- Proxy: Railway `GET /api/yahoo`
- Directo: desde celular/browser (fallback Build 15)
- API key: NO

### Fuente 6 — Alpha Vantage
- URL: `alphavantage.co/query`
- API key: Sí (`ALPHA_KEY`)
- Límite: 25 calls/min

### Cache emergencia
- TTL: 30 min
- Solo si todas las fuentes fallan

---

## LOGOS

### Crypto/Stable
| Prioridad | Fuente | URL |
|-----------|--------|-----|
| 1 | assets.js | URLs CoinGecko images (estáticas) |
| 2 | CoinCap | `assets.coincap.io/assets/icons/` |
| 3 | Círculo | Iniciales + color |

### Acciones/ETFs
| Prioridad | Fuente | URL |
|-----------|--------|-----|
| 1 | assets.js | URLs FMP/Clearbit (estáticas) |
| 2 | FMP | `financialmodelingprep.com/image-stock/` |
| 3 | Clearbit | `logo.clearbit.com/` (30 dominios mapeados) |
| 4 | Círculo | Iniciales + color |

### Commodities/Futuros/Bonos/Divisas
| Prioridad | Fuente |
|-----------|--------|
| 1 | Círculo con símbolo y color específico (AssetLogo.js SYMBOL_COLORS) |

---

## ENDPOINT `/api/crypto-prices`

- URL: `https://aurex-app-production.up.railway.app/api/crypto-prices`
- Respuesta: `{ ok: true, source: "cryptocompare", count: 53, prices: {...} }`
- Actualización: cada 2 min via `refreshCryptoCache`
- Sirve a: PWA (5 catches crypto) + Nativa (catch Binance en 3 screens)

---

## ASYNCSTORAGE CACHE (Nativa Build 15)

| Key | Dato | Escribe | Lee (fallback) |
|-----|------|---------|----------------|
| aurex_ia_cache | signals + prices + ts | IAScreen éxito | IAScreen fallo |
| aurex_pulse_cache | pulse data + ts | MercadosScreen éxito | MercadosScreen fallo |
| aurex_ia_signals_map | { simbolo: signal } | MercadosScreen éxito | MercadosScreen fallo |
| aurex_wl_ia_cache | { simbolo: signal } | WatchlistScreen éxito | WatchlistScreen fallo |
| aurex_port_ia_cache | { simbolo: signal } | PortfolioScreen éxito | PortfolioScreen fallo |
| aurex_port_data | [ portfolio items ] | PortfolioScreen éxito | PortfolioScreen fallo |
| aurex_wl_data | { lists, items } | WatchlistScreen éxito | WatchlistScreen fallo |

---

## CONSUMO ESTIMADO CRYPTOCOMPARE (Binance caído en Railway)

| Origen | Frecuencia | Calls/mes |
|--------|-----------|-----------|
| refreshCryptoCache | cada 2 min | 21.600 |
| checkAlertas | cada 30 seg | 86.400 |
| calcularPulse fallback | cada 5 min | 8.640 |
| Motor IA fallback | variable | ~5.000-15.000 |
| **Total estimado** | — | **~121.000-131.000** |

⚠️ Supera 100k/mes. Monitorear con contador + alertas 80k/95k.

---

## LOCALSTORAGE CACHE (PWA commit 4fb7421)

| Key | Dato | Escribe | Lee (fallback) |
|-----|------|---------|----------------|
| aurex_ia_pwa_cache | { signals, ts } | generarSenalesIA éxito | _iaLoadFromCache tras 3 fallos |
| aurex_wl_pwa_cache | { lists, items } | _wlSyncFromSupabase éxito | _wlSyncFromSupabase fallo |
| aurex_port_items_cache | [ portfolio items ] | (ya existía) | _fetchPortfolio fallo |

---

## ESTADO ACTUAL (21/04/2026)

| Servicio | Backend Railway | Nativa (celular) | PWA (browser) |
|----------|----------------|-----------------|---------------|
| Binance | ❌ Bloqueado | ✅ Funciona | ✅ Funciona |
| CryptoCompare | ✅ Activa (con key) | — | — |
| Kraken | ✅ Disponible | — | — |
| CoinGecko | ✅ Disponible | — | — |
| Yahoo | ✅ Funciona | ✅ Directo + proxy | ✅ Directo + proxy |
| Alpha Vantage | ✅ Funciona | — | — |
| Evolution WA | ✅ Connected | — | — |
| Supabase | ✅ Online | — | — |
| /api/crypto-prices | ✅ count:53 | ✅ Fallback | ✅ Fallback (5 catches) |
| AsyncStorage cache | — | ✅ 7 keys | — |
| localStorage cache | — | — | ✅ 3 keys |
